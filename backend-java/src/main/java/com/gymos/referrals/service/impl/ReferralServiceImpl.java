package com.gymos.referrals.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Contacts;
import com.gymos.referrals.dao.ReferralDao;
import com.gymos.referrals.service.ReferralService;

@Service
public class ReferralServiceImpl implements ReferralService {

    private static final List<String> STATUSES = List.of("pending", "joined", "rewarded", "lapsed");

    /**
     * {@code days} adds time to the referrer's membership — the reward gyms
     * actually use, because it costs nothing and brings the member back in.
     * {@code credit} and {@code cash} are recorded for the desk to settle.
     */
    private static final List<String> REWARD_TYPES = List.of("days", "credit", "cash");

    private static final int MAX_REWARD_DAYS = 365;
    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    private final ReferralDao referralDao;
    private final AuditService audit;

    public ReferralServiceImpl(ReferralDao referralDao, AuditService audit) {
        this.referralDao = referralDao;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(Long referrerId, String status, String limit) {
        requireStatus(status);
        return referralDao.findReferrals(referrerId, status, clamp(limit));
    }

    @Override
    public Map<String, Object> summary(String limit) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("counts", referralDao.counts());
        out.put("top_referrers", referralDao.topReferrers(clampTop(limit)));
        return out;
    }

    @Override
    public Map<String, Object> lookupCode(String code) {
        if (code == null || code.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "A referral code is required");
        }
        Map<String, Object> member = referralDao.findByReferralCode(code.trim()).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "No member owns the code " + code.trim() + "."));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("referrer", member);
        out.put("referrals", referralDao.findReferrals(Body.toLong(member.get("id")), null, 50));
        return out;
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long createdBy) {
        Long referrerId = Body.toLong(body.get("referrer_id"));
        String code = Body.str(body, "referral_code");

        // Either the member id or their shareable code identifies the referrer —
        // the desk usually has the code, the member app has the id.
        if (referrerId == null && code != null && !code.isBlank()) {
            referrerId = referralDao.findByReferralCode(code.trim())
                .map(m -> Body.toLong(m.get("id")))
                .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND,
                    "No member owns the code " + code.trim() + "."));
        }
        if (referrerId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "referrer_id or referral_code is required");
        }
        String referredName = Body.str(body, "referred_name");
        if (referredName == null || referredName.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "The referred person's name is required");
        }
        // A name alone cannot identify anyone — plenty of gyms have three
        // members called Rahul Sharma, and the desk has to be able to match
        // the person walking in against the invitation that earns the reward.
        String phoneError = Contacts.phoneError(Body.str(body, "referred_phone"), true);
        if (phoneError != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                phoneError + " It is how the desk matches the person when they arrive.");
        }
        // Stored in the comparable form, so "+91 98765 43210", "09876543210" and
        // "9876543210" are one number rather than three ways to claim the reward
        // twice for the same friend.
        String referredPhone = Contacts.comparablePhone(Body.str(body, "referred_phone"));

        Map<String, Object> referrer = referralDao.findMember(referrerId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referring member not found"));

        // A referral is for bringing someone else in. Referring yourself passed
        // every other check and paid out.
        String ownPhone = Contacts.comparablePhone(String.valueOf(referrer.get("phone")));
        if (!ownPhone.isEmpty() && ownPhone.equals(referredPhone)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "That is your own number. A referral is for a friend who is not a member yet.");
        }

        // The same friend invited twice is one friend, not two rewards.
        Map<String, Object> already = referralDao.findOpenInviteByPhone(referrerId, referredPhone).orElse(null);
        if (already != null) {
            throw new BusinessException(HttpStatus.CONFLICT,
                "You have already invited " + already.get("referred_name") + " on that number.");
        }

        String rewardType = Body.str(body, "reward_type");
        requireRewardType(rewardType);
        BigDecimal rewardValue = rewardValue(body, rewardType);

        Map<String, Object> referral = referralDao.insert(referrerId, referredName.trim(),
            referredPhone, Body.str(body, "referred_email"),
            Body.toLong(body.get("lead_id")),
            rewardType == null || rewardType.isBlank() ? "days" : rewardType,
            // referrals.reward_value is NOT NULL with a default of 0, but a
            // column default only applies when the INSERT leaves it out — and
            // this one always names it. Passing null therefore hit the
            // constraint and surfaced as "this value is already taken", which
            // is what a referral with no stated reward looked like from the UI.
            rewardValue == null ? BigDecimal.ZERO : rewardValue,
            Body.str(body, "notes"), createdBy);

        audit.record("create", "referrals", referral.get("id"),
            referrer.get("name") + " referred " + referredName.trim());
        return referral;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        requireStatus(status);
        String rewardType = body.containsKey("reward_type") ? Body.str(body, "reward_type") : null;
        requireRewardType(rewardType);

        referralDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referral not found"));

        Map<String, Object> updated = referralDao.update(id, status, null, rewardType,
            rewardValue(body, rewardType), body.containsKey("notes") ? Body.str(body, "notes") : null,
            false);
        audit.record("update", "referrals", id, "Referral #" + id + " → " + updated.get("status"));
        return updated;
    }

    @Override
    public Map<String, Object> markJoined(Long id, Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "member_id is required — which member did this referral become?");
        }
        Map<String, Object> referral = referralDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referral not found"));
        if ("rewarded".equals(String.valueOf(referral.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "This referral has already been rewarded.");
        }
        Map<String, Object> member = referralDao.findMember(memberId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));

        // A member cannot refer themselves — the cheapest way to farm free days.
        if (memberId.equals(Body.toLong(referral.get("referrer_id")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A member cannot be their own referral.");
        }

        Map<String, Object> updated = referralDao.update(id, "joined", memberId, null, null, null, false);
        audit.record("convert", "referrals", id,
            referral.get("referred_name") + " joined as " + member.get("name")
                + " (ID " + member.get("member_code") + ")");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", referral.get("referred_name") + " linked to " + member.get("name")
            + ". The reward is ready to pay.");
        out.put("referral", updated);
        return out;
    }

    @Override
    public Map<String, Object> payReward(Long id) {
        Map<String, Object> referral = referralDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referral not found"));
        String status = String.valueOf(referral.get("status"));

        // The reward is earned by a conversion, not by a name on a list —
        // otherwise a member could claim for anyone they ever mentioned.
        if (!"joined".equals(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "rewarded".equals(status)
                    ? "This referral has already been rewarded."
                    : "Only a referral that actually joined can be rewarded. Link the member first.");
        }

        String rewardType = String.valueOf(referral.get("reward_type"));
        BigDecimal value = Body.toDecimal(referral.get("reward_value"));
        Long referrerId = Body.toLong(referral.get("referrer_id"));
        Map<String, Object> referrer = referralDao.findMember(referrerId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referring member not found"));

        String detail;
        if ("days".equals(rewardType) && value != null && value.signum() > 0) {
            Map<String, Object> extended = referralDao.extendMembership(referrerId, value.intValue());
            detail = value.intValue() + " day(s) added — " + referrer.get("name")
                + " now expires " + extended.get("membership_expiry") + ".";
        } else if (value != null && value.signum() > 0) {
            detail = "₹" + value + " " + rewardType + " recorded for " + referrer.get("name") + ".";
        } else {
            detail = "Marked rewarded (no value set).";
        }

        Map<String, Object> updated = referralDao.update(id, "rewarded", null, null, null, null, true);
        audit.record("reward", "referrals", id,
            "Rewarded " + referrer.get("name") + " for referring " + referral.get("referred_name")
                + " — " + detail);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", detail);
        out.put("referral", updated);
        return out;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> referral = referralDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Referral not found"));
        if ("rewarded".equals(String.valueOf(referral.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A rewarded referral is a paid-out record and cannot be deleted.");
        }
        referralDao.delete(id);
        audit.record("delete", "referrals", id,
            "Deleted referral of " + referral.get("referred_name"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Referral removed.");
        out.put("referral", referral);
        return out;
    }

    // ---- helpers -------------------------------------------------------------

    /** Phone numbers are compared and stored as digits — "+91 98765 43210" is one number. */
    private static String digits(String raw) {
        return Contacts.digitsOf(raw);
    }

    private static void requireStatus(String status) {
        if (status != null && !status.isBlank() && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
    }

    private static void requireRewardType(String rewardType) {
        if (rewardType != null && !rewardType.isBlank() && !REWARD_TYPES.contains(rewardType)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "reward_type must be one of: " + String.join(", ", REWARD_TYPES));
        }
    }

    private static BigDecimal rewardValue(Map<String, Object> body, String rewardType) {
        Object raw = body.get("reward_value");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        BigDecimal value = Body.toDecimal(raw);
        if (value == null || value.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "reward_value must be a non-negative number");
        }
        // Days are whole and bounded — "365 free days" is already generous, and
        // anything larger is a typo that would hand out a decade of membership.
        if ("days".equals(rewardType)) {
            if (value.stripTrailingZeros().scale() > 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "reward_value must be a whole number of days");
            }
            if (value.intValue() > MAX_REWARD_DAYS) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "reward_value cannot exceed " + MAX_REWARD_DAYS + " days");
            }
        }
        return value;
    }

    private static int clamp(String raw) {
        return bounded(raw, DEFAULT_LIMIT, MAX_LIMIT);
    }

    private static int clampTop(String raw) {
        return bounded(raw, 10, 100);
    }

    private static int bounded(String raw, int fallback, int max) {
        if (raw == null || raw.isBlank()) {
            return fallback;
        }
        try {
            return Math.min(max, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    // ── Member portal ────────────────────────────────────────────────────

    /** The offer in the gym's own words, with sane fallbacks. */
    private Map<String, Object> offer() {
        Map<String, String> cfg = referralDao.rewardSettings();
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        String value = cfg.getOrDefault("reward_value", "100");
        out.put("enabled", !"false".equalsIgnoreCase(cfg.getOrDefault("enabled", "true")));
        out.put("type", cfg.getOrDefault("reward_type", "discount"));
        out.put("value", value);
        out.put("plan", cfg.getOrDefault("reward_plan", "Quarterly"));
        out.put("label", cfg.getOrDefault("reward_label", "").isBlank()
            ? "₹" + value + " off your next membership"
            : cfg.get("reward_label"));
        return out;
    }

    /**
     * The settings describe the offer in the gym's language ("discount"), while
     * a referral row records how it is settled. Anything that is not extra
     * membership days is money owed to the referrer, which the desk settles as
     * credit.
     */
    private static String rewardTypeFor(Map<String, Object> offer) {
        String type = String.valueOf(offer.get("type"));
        return REWARD_TYPES.contains(type) ? type : "credit";
    }

    @Override
    public Map<String, Object> memberSummary(Long memberId) {
        Map<String, Object> me = referralDao.findMember(memberId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Member not found."));

        List<Map<String, Object>> mine = referralDao.findReferrals(memberId, null, 100);

        // Only the member's own invitations, and only the fields they already
        // know — the name and phone they typed in themselves.
        List<Map<String, Object>> safe = new java.util.ArrayList<>();
        int joined = 0;
        int pending = 0;
        java.math.BigDecimal earned = java.math.BigDecimal.ZERO;
        for (Map<String, Object> r : mine) {
            String status = String.valueOf(r.get("status"));
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", r.get("id"));
            row.put("name", r.get("referred_name"));
            row.put("status", status);
            row.put("created_at", r.get("created_at"));
            row.put("reward_value", r.get("reward_value"));
            row.put("reward_paid_on", r.get("reward_paid_on"));
            safe.add(row);
            if ("joined".equals(status) || "rewarded".equals(status)) {
                joined++;
                if (r.get("reward_value") != null) {
                    earned = earned.add(new java.math.BigDecimal(String.valueOf(r.get("reward_value"))));
                }
            } else if ("pending".equals(status) || "contacted".equals(status)) {
                pending++;
            }
        }

        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("referral_code", me.get("referral_code"));
        out.put("member_name", me.get("name"));
        out.put("offer", offer());
        out.put("invited", safe.size());
        out.put("joined", joined);
        out.put("pending", pending);
        out.put("earned", earned);
        out.put("referrals", safe);
        return out;
    }

    // ── The reward loop ──────────────────────────────────────────────────

    @Override
    public Map<String, Object> requireReferrer(String referralCode) {
        if (referralCode == null || referralCode.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "A referral code is required.");
        }
        return referralDao.findByReferralCode(referralCode.trim()).orElseThrow(() ->
            new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + referralCode.trim() + "\" does not match any member's referral code."
                    + " Check it with the member who gave it."));
    }

    @Override
    public void linkNewMember(Long newMemberId, String referralCode, String phone, String name) {
        if (referralCode == null || referralCode.isBlank()) {
            return;
        }
        Map<String, Object> referrer = requireReferrer(referralCode);

        Long referrerId = Body.toLong(referrer.get("id"));
        if (referrerId.equals(newMemberId)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A member cannot refer themselves.");
        }
        referralDao.setReferredBy(newMemberId, referrerId);

        Map<String, Object> offer = offer();
        // The referrer usually recorded this friend from their portal before
        // they arrived. Reuse that row rather than creating a second one, or
        // the same person counts twice on the leaderboard.
        Map<String, Object> invite = referralDao.findOpenInviteByPhone(referrerId, phone).orElse(null);
        Long referralId;
        if (invite != null) {
            referralId = Body.toLong(invite.get("id"));
        } else {
            referralId = Body.toLong(referralDao.insert(referrerId, name == null ? "New member" : name.trim(),
                digits(phone), null, null, rewardTypeFor(offer),
                new BigDecimal(String.valueOf(offer.get("value"))),
                "Signed up at the desk with the referral code", null).get("id"));
        }
        referralDao.update(referralId, "joined", newMemberId, null, null, null, false);
        audit.record("convert", "referrals", referralId,
            referrer.get("name") + " referred " + (name == null ? "a new member" : name)
                + " (code " + referralCode.trim() + ")");
    }

    @Override
    public void settleForMember(Long memberId) {
        Map<String, Object> referral = referralDao.findByConvertedMember(memberId).orElse(null);
        if (referral == null || !"joined".equals(String.valueOf(referral.get("status")))) {
            // Nobody referred them, or the reward has already been paid.
            return;
        }
        Map<String, Object> member = referralDao.findMember(memberId).orElse(null);
        if (member == null) {
            return;
        }
        // The reward is for a member the gym actually got paid for. Crediting
        // on signup alone would pay out for anyone who walked in, gave a code
        // and never came back.
        BigDecimal due = Body.toDecimal(member.get("amount_due"));
        if (due != null && due.signum() > 0) {
            return;
        }
        payReward(Body.toLong(referral.get("id")));
    }

    @Override
    public Discount pendingDiscount(Long memberId, BigDecimal fee) {
        List<Map<String, Object>> rewards = referralDao.findUnredeemedRewards(memberId);
        if (rewards.isEmpty() || fee == null || fee.signum() <= 0) {
            return new Discount(BigDecimal.ZERO, List.of(), null);
        }
        BigDecimal total = BigDecimal.ZERO;
        List<Long> used = new java.util.ArrayList<>();
        List<String> names = new java.util.ArrayList<>();
        for (Map<String, Object> r : rewards) {
            if (total.compareTo(fee) >= 0) {
                // Never discount below zero, and never spend a reward that
                // would be wasted — it stays banked for the next renewal.
                break;
            }
            BigDecimal value = Body.toDecimal(r.get("reward_value"));
            if (value == null || value.signum() <= 0) {
                continue;
            }
            total = total.add(value);
            used.add(Body.toLong(r.get("id")));
            names.add(referredLabel(r));
        }
        if (used.isEmpty()) {
            return new Discount(BigDecimal.ZERO, List.of(), null);
        }
        BigDecimal applied = total.min(fee);
        return new Discount(applied, used, receiptNote(applied, names));
    }

    @Override
    public void redeem(Discount discount) {
        if (discount != null && discount.any()) {
            referralDao.markRedeemed(discount.referralIds());
        }
    }

    /** "744 - Rahul Sharma" — the Member ID first, because that is what the desk searches on. */
    private static String referredLabel(Map<String, Object> referral) {
        Object code = referral.get("converted_member_code");
        String name = String.valueOf(referral.get("referred_name"));
        return code == null || String.valueOf(code).isBlank() ? name : code + " - " + name;
    }

    /**
     * What the member reads on the receipt. Spelling out that the discount is
     * one-off is the whole point: a member who assumes their fee is
     * permanently lower argues about it at the desk next time, and one who
     * knows it came from referring somebody refers somebody else.
     */
    private static String receiptNote(BigDecimal amount, List<String> referred) {
        String who = String.join(", ", referred);
        return "Referral reward — you introduced " + who + ".\n"
            + "\u20b9" + amount.stripTrailingZeros().toPlainString()
            + " off applied to this membership.\n"
            + "Future memberships are charged at the normal rate."
            + " Keep referring to keep the benefit.";
    }

    @Override
    public Map<String, Object> inviteFromPortal(Long memberId, Map<String, Object> body) {
        if (!Boolean.TRUE.equals(offer().get("enabled"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN,
                "Referrals are not running at the moment. Ask at the front desk.");
        }
        Map<String, Object> offer = offer();
        // The referrer is taken from the member's own token, never from the
        // body — otherwise one member could bank rewards against another. The
        // reward is likewise the gym's configured offer and not the member's
        // suggestion, and it is stamped onto the row now so that changing the
        // promotion later never rewrites what this member was promised.
        Map<String, Object> payload = new java.util.LinkedHashMap<>(body == null ? Map.of() : body);
        payload.put("referrer_id", memberId);
        payload.put("reward_type", rewardTypeFor(offer));
        payload.put("reward_value", offer.get("value"));
        Map<String, Object> created = create(payload, null);
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("message", "Invitation recorded. We'll credit you when they join.");
        out.put("referral", created);
        return out;
    }
}
