package com.gymos.member.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Contacts;
import com.gymos.common.util.Dates;
import com.gymos.common.util.Names;
import com.gymos.lockers.dao.LockerDao;
import com.gymos.lockers.service.LockerService;
import com.gymos.member.dao.ClientDao;
import com.gymos.member.service.MemberService;
import com.gymos.plans.service.PlanCatalog;
import com.gymos.referrals.ReferralCodes;
import com.gymos.referrals.service.ReferralService;
import com.gymos.notification.service.ReminderService;
import com.gymos.payment.dao.PaymentContext;
import com.gymos.payment.dao.PaymentDao;

/**
 * Member service — exact port of clientController.js: same validations, same
 * messages, same status codes. All SQL is in ClientDao/PaymentDao.
 */
@Service
public class MemberServiceImpl implements MemberService {

    private static final Logger log = LoggerFactory.getLogger("clientController");
    private static final String PAYMENT_MODE_ERROR =
        "payment_mode must be one of: Cash, UPI, Card, Bank Transfer, Online";
    private static final List<String> DATE_FIELDS =
        List.of("dob", "join_date", "membership_start", "membership_expiry");

    private final ClientDao clientDao;
    private final PaymentDao paymentDao;
    private final ReminderService reminderService;
    private final ReferralService referralService;
    private final LockerService lockerService;
    private final LockerDao lockerDao;
    private final AuditService audit;
    private final TransactionTemplate tx;

    public MemberServiceImpl(ClientDao clientDao, PaymentDao paymentDao,
                             ReminderService reminderService, ReferralService referralService,
                             LockerService lockerService, LockerDao lockerDao,
                             AuditService audit, TransactionTemplate tx) {
        this.clientDao = clientDao;
        this.paymentDao = paymentDao;
        this.reminderService = reminderService;
        this.referralService = referralService;
        this.lockerService = lockerService;
        this.lockerDao = lockerDao;
        this.audit = audit;
        this.tx = tx;
    }

    // ------------------------------------------------------------------ reads

    @Override
    public List<Map<String, Object>> listAll() {
        return clientDao.findAllWithTrainer();
    }

    @Override
    public Map<String, Object> get(Long id) {
        Map<String, Object> member = clientDao.findByIdWithTrainer(id)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        // A locker assigned from the Lockers page has to be visible here too,
        // or the desk sees a different answer depending on which screen it
        // opened. It is one fact about the member either way.
        member.put("locker", lockerDao.findHeldBy(id).orElse(null));
        return member;
    }

    @Override
    public List<Map<String, Object>> events(Long id) {
        requireMember(id);
        return clientDao.findEvents(id);
    }

    // ---------------------------------------------------------------- create

    @Override
    public Long nextMemberCode() {
        return clientDao.nextMemberCode();
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body) {
        String name = Body.str(body, "name");
        if (name == null || name.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Member name is required");
        }
        if (name.trim().length() < MIN_NAME_LENGTH) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Enter the member's full name — a single letter is not one.");
        }
        String contactError = validateContact(body, true);
        if (contactError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, contactError);
        String codeError = validateMemberCode(Body.str(body, "member_code"));
        if (codeError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, codeError);
        String code = String.valueOf(body.get("member_code")).trim();
        String dateError = validateDates(body);
        if (dateError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, dateError);
        if (!isValidPaymentMode(Body.str(body, "payment_mode"))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PAYMENT_MODE_ERROR);
        }
        String cardUidError = validateCardUid(Body.str(body, "card_uid"));
        if (cardUidError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, cardUidError);
        String normCardUid = normalizeCardUid(Body.str(body, "card_uid"));
        String fingerprintStatus = Boolean.TRUE.equals(Body.bool(body, "activate_fingerprint"))
            ? "pending" : "not_enrolled";

        BigDecimal fee = Body.toNonNeg(body, "membership_fee");
        BigDecimal paid = Body.toNonNeg(body, "amount_paid");
        if (Body.isNan(fee)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "membership_fee must be a non-negative number");
        }
        if (Body.isNan(paid)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount_paid must be a non-negative number");
        }
        String moneyError = validateMoney(fee, paid);
        if (moneyError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, moneyError);

        BigDecimal due = Body.toNonNeg(body, "amount_due");
        if (Body.isNan(due)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount_due must be a non-negative number");
        }
        if (due == null) {
            due = max0((fee == null ? BigDecimal.ZERO : fee).subtract(paid == null ? BigDecimal.ZERO : paid));
        }

        String type = Body.str(body, "membership_type") == null ? "Monthly" : Body.str(body, "membership_type");
        String join = Body.str(body, "join_date") == null ? Dates.todayStr() : Body.str(body, "join_date");
        String start = Body.str(body, "membership_start") == null ? join : Body.str(body, "membership_start");
        String expiry = Body.str(body, "membership_expiry") == null
            ? Dates.addDays(start, Dates.durationDays(type)) : Body.str(body, "membership_expiry");

        // Resolved before anything is written. A code that matches nobody has
        // to stop the signup here — validating it after the insert left a
        // member created and paid for behind a 400, and the retry then failed
        // with "Member ID already taken".
        String referralCode = Body.str(body, "referral_code");
        if (referralCode != null && !referralCode.isBlank()) {
            referralService.requireReferrer(referralCode);
        }

        // Friendly duplicate checks before the unique index.
        Optional<Map<String, Object>> dup = clientDao.findByMemberCode(code);
        if (dup.isPresent()) {
            throw new BusinessException(HttpStatus.CONFLICT,
                "Member ID " + code + " is already taken by " + dup.get().get("name") + ".");
        }
        if (normCardUid != null) {
            Optional<Map<String, Object>> cardDup = clientDao.findByCardUid(normCardUid);
            if (cardDup.isPresent()) {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "Card UID " + normCardUid + " is already assigned to " + cardDup.get().get("name") + ".");
            }
        }

        // Title Case on the way in, so "GAURAV SHARMA" and "gaurav sharma" are
        // one member on every screen that lists, sorts or prints them.
        Map<String, Object> client = clientDao.insert(code, Names.titleCase(name), Body.str(body, "phone"),
            Body.str(body, "email"), Names.titleCase(Body.str(body, "address")), Body.str(body, "gender"),
            Body.str(body, "dob"), join, type, start, expiry, fee, paid, due,
            Body.str(body, "payment_mode"), Body.str(body, "status") == null ? "active" : Body.str(body, "status"),
            Body.toLong(body.get("trainer_id")), normCardUid, fingerprintStatus);

        // The number is now this member's, and stays theirs while the record
        // exists — deactivated or not.
        clientDao.claimMemberCode(code, Body.toLong(client.get("id")));

        // Every member needs a referral code from the moment they exist —
        // previously only db/migrate.js ever set one, so anybody signed up
        // after the migration opened the Refer & earn tab to a blank code.
        if (client.get("id") != null) {
            // Their own code, to hand out. Not to be confused with
            // referralCode above, which is whoever's code brought them in.
            String ownCode = ReferralCodes.forMember(
                String.valueOf(client.get("name")), String.valueOf(client.get("member_code")));
            clientDao.assignReferralCode(Body.toLong(client.get("id")), ownCode)
                .ifPresentOrElse(
                    assigned -> client.put("referral_code", assigned),
                    () -> log.warn("Referral code {} is already in use — {} (ID {}) has none.",
                        ownCode, client.get("name"), client.get("member_code")));
        }

        if (client.get("id") != null && paid != null && paid.signum() > 0) {
            paymentDao.insert(Body.toLong(client.get("id")), paid, Dates.todayStr(),
                Body.str(body, "payment_mode") == null ? "Cash" : Body.str(body, "payment_mode"), null,
                PaymentContext.membership(type, start, expiry));
        }

        // "Who told you about us?" — the code was already checked above, so
        // this can only fail on something genuinely exceptional.
        if (referralCode != null && !referralCode.isBlank()) {
            referralService.linkNewMember(Body.toLong(client.get("id")), referralCode,
                Body.str(body, "phone"), name.trim());
            // Paid up front, so the referrer has earned their reward already.
            referralService.settleForMember(Body.toLong(client.get("id")));
            client.put("referred_by_code", referralCode.trim().toUpperCase());
        }
        if ("pending".equals(fingerprintStatus)) {
            log.info("Fingerprint enrollment requested for {} ({}) — member data sent to machine.",
                client.get("member_code"), client.get("name"));
        }
        // A locker taken at signup goes through the Lockers module, not around
        // it: same guards, same ledger entry, same invoice, so the Lockers page
        // and the member's record can never tell different stories.
        applyLocker(Body.toLong(client.get("id")), body, client);
        return client;
    }

    /**
     * Assigns, re-dates or releases the member's locker from a member form.
     *
     * @param body the member payload. {@code assign_locker} false releases
     *             whatever they hold; a {@code locker_number} assigns one.
     *             Neither present means the form never asked, so nothing moves.
     */
    private void applyLocker(Long memberId, Map<String, Object> body, Map<String, Object> out) {
        boolean asked = body.containsKey("assign_locker") || body.containsKey("locker_number");
        if (memberId == null || !asked) return;

        Boolean wanted = Body.bool(body, "assign_locker");
        String number = Body.str(body, "locker_number");
        boolean assigning = Boolean.TRUE.equals(wanted)
            || (wanted == null && number != null && !number.isBlank());

        if (!assigning) {
            lockerService.releaseHeldBy(memberId);
            out.put("locker", null);
            return;
        }
        if (number == null || number.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Enter the locker number you are assigning.");
        }

        // Already holding this one: only the dates and the rent can move, and
        // re-assigning would trip the "one locker per member" guard.
        Map<String, Object> held = lockerDao.findHeldBy(memberId).orElse(null);
        if (held != null && number.trim().equalsIgnoreCase(String.valueOf(held.get("locker_number")))) {
            String until = Body.str(body, "locker_until");
            if (until != null && !until.isBlank()) {
                if (!Dates.isValidDateString(until)) {
                    throw new BusinessException(HttpStatus.BAD_REQUEST,
                        "locker_until must be a valid date in YYYY-MM-DD format");
                }
                lockerDao.assign(Body.toLong(held.get("id")), memberId,
                    String.valueOf(held.get("assigned_from")), until);
            }
            out.put("locker", lockerDao.findHeldBy(memberId).orElse(null));
            return;
        }
        if (held != null) lockerService.releaseHeldBy(memberId);

        Map<String, Object> assign = new java.util.LinkedHashMap<>();
        assign.put("locker_number", number);
        assign.put("assigned_until", Body.str(body, "locker_until"));
        assign.put("amount", body.get("locker_amount"));
        assign.put("method", Body.str(body, "payment_mode") == null
            ? "Cash" : Body.str(body, "payment_mode"));
        Map<String, Object> result = lockerService.assignByNumber(memberId, assign);
        out.put("locker", result.get("locker"));
        out.put("locker_invoice", result.get("invoice"));
    }

    // ---------------------------------------------------------------- update

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        Map<String, Object> current = requireMember(id);
        if (body.containsKey("member_code")) {
            String codeError = validateMemberCode(Body.str(body, "member_code"));
            if (codeError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, codeError);
            String code = String.valueOf(body.get("member_code")).trim();
            Optional<Map<String, Object>> dup = clientDao.findByMemberCodeExcept(code, id);
            if (dup.isPresent()) {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "Member ID " + code + " is already taken by " + dup.get().get("name") + ".");
            }
        }
        String dateError = validateDates(body);
        if (dateError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, dateError);
        if (body.containsKey("name") && Body.str(body, "name") != null
                && Body.str(body, "name").trim().length() < MIN_NAME_LENGTH) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Enter the member's full name — a single letter is not one.");
        }
        // An edit is only checked on what it actually sends: a form that never
        // touched the phone number must not be blocked by it.
        if (body.containsKey("phone") || body.containsKey("email")) {
            String contactError = validateContact(body, body.containsKey("phone"));
            if (contactError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, contactError);
        }
        if (body.containsKey("payment_mode") && !isValidPaymentMode(Body.str(body, "payment_mode"))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PAYMENT_MODE_ERROR);
        }

        String cardUidError = validateCardUid(Body.str(body, "card_uid"));
        if (cardUidError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, cardUidError);
        boolean cardUidSet = body.containsKey("card_uid");
        String cardUidValue = cardUidSet ? normalizeCardUid(Body.str(body, "card_uid")) : null;
        if (cardUidValue != null) {
            Optional<Map<String, Object>> cardDup = clientDao.findByCardUidExcept(cardUidValue, id);
            if (cardDup.isPresent()) {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "Card UID " + cardUidValue + " is already assigned to " + cardDup.get().get("name") + ".");
            }
        }
        boolean fpSet = body.containsKey("activate_fingerprint");
        String fpValue = fpSet ? fingerprintStatusFromToggle(
            Boolean.TRUE.equals(Body.bool(body, "activate_fingerprint")),
            String.valueOf(current.get("fingerprint_status"))) : null;

        // create() validates money and the date pair; update() did not, so every
        // rule was reachable simply by editing the member afterwards — a negative
        // fee, amount_paid above the fee, or an expiry moved behind the stored
        // start date. A partial update also has to be judged on the EFFECTIVE
        // values (what is sent, falling back to what is stored), because sending
        // only one half of a pair skipped the check entirely.
        String editError = validateEffectiveUpdate(current, body);
        if (editError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, editError);

        BigDecimal dueValue = null;
        if (body.containsKey("amount_due") && body.get("amount_due") != null
            && !"".equals(String.valueOf(body.get("amount_due")))) {
            BigDecimal d = Body.toNonNeg(body, "amount_due");
            if (Body.isNan(d)) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "amount_due must be a non-negative number");
            }
            dueValue = d;
        } else if (body.containsKey("membership_fee") || body.containsKey("amount_paid")) {
            BigDecimal newFee = body.containsKey("membership_fee") && body.get("membership_fee") != null
                ? Body.toDecimal(body.get("membership_fee")) : toDecimalOr0(current.get("membership_fee"));
            BigDecimal newPaid = body.containsKey("amount_paid") && body.get("amount_paid") != null
                ? Body.toDecimal(body.get("amount_paid")) : toDecimalOr0(current.get("amount_paid"));
            dueValue = max0(newFee.subtract(newPaid));
        }

        Map<String, Object> updated = clientDao.update(id,
            Names.titleCase(Body.str(body, "name")), Body.str(body, "phone"), Body.str(body, "email"),
            Names.titleCase(Body.str(body, "address")), Body.str(body, "gender"), Body.str(body, "dob"),
            Body.str(body, "join_date"), Body.str(body, "membership_type"),
            Body.str(body, "membership_start"), Body.str(body, "membership_expiry"),
            Body.toDecimal(body.get("membership_fee")), Body.toDecimal(body.get("amount_paid")),
            Body.str(body, "payment_mode"), Body.str(body, "status"),
            Body.toLong(body.get("trainer_id")),
            body.containsKey("member_code") ? String.valueOf(body.get("member_code")).trim() : null,
            Body.bool(body, "auto_renew"), Body.str(body, "recurring_method"),
            dueValue, cardUidSet, cardUidValue, fpSet, fpValue);

        if (body.containsKey("member_code")) {
            String newCode = String.valueOf(body.get("member_code")).trim();
            if (!newCode.equals(String.valueOf(current.get("member_code")))) {
                clientDao.cascadeAttendanceCode(String.valueOf(current.get("member_code")), newCode);
            }
        }
        applyLocker(id, body, updated);
        return updated;
    }

    // --------------------------------------------------------------- lifecycle

    @Override
    public Map<String, Object> renew(Long id, Map<String, Object> body) {
        Map<String, Object> member = requireMember(id);
        String type = Body.str(body, "membership_type");
        if (type == null) {
            type = member.get("membership_type") == null ? "Monthly" : String.valueOf(member.get("membership_type"));
        }
        Object monthsRaw = body.get("months");
        int days = monthsRaw != null && Body.toInt(monthsRaw) > 0
            ? Body.toInt(monthsRaw) * 30 : Dates.durationDays(type);

        BigDecimal paid = Body.toNonNeg(body, "amount_paid");
        if (paid == null && Body.containsKey(body, "amount")) paid = Body.toNonNeg(body, "amount");
        if (Body.isNan(paid)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount_paid must be a non-negative number");
        }
        BigDecimal fee = Body.toNonNeg(body, "membership_fee");
        if (Body.isNan(fee)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "membership_fee must be a non-negative number");
        }
        String mode = Body.str(body, "payment_mode");
        if (mode == null && Body.containsKey(body, "method")) mode = Body.str(body, "method");
        if (mode != null && !isValidPaymentMode(mode)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PAYMENT_MODE_ERROR);
        }

        String today = Dates.todayStr();
        String base = member.get("membership_expiry") != null
            && String.valueOf(member.get("membership_expiry")).compareTo(today) >= 0
            ? String.valueOf(member.get("membership_expiry")) : today;
        String newExpiry = Dates.addDays(base, days);

        BigDecimal chargedFee = fee != null ? fee : toDecimalOr0(member.get("membership_fee"));

        // Rewards this member earned by introducing people who then paid up.
        // Worked out before anything is written, and only marked spent once
        // the renewal has actually gone through — a renewal that falls over
        // must not quietly burn someone's referral credit.
        ReferralService.Discount discount = referralService.pendingDiscount(id, chargedFee);
        if (discount.any()) {
            chargedFee = max0(chargedFee.subtract(discount.amount()));
            fee = chargedFee;
        }

        BigDecimal renewDue = null;
        if (fee != null || paid != null) {
            BigDecimal newPaid = paid != null ? paid : toDecimalOr0(member.get("amount_paid"));
            renewDue = max0(chargedFee.subtract(newPaid));
        }

        Map<String, Object> updated = clientDao.renew(id, newExpiry, type, fee, paid, mode, renewDue);
        BigDecimal due = max0(toDecimalOr0(updated.get("membership_fee")).subtract(toDecimalOr0(updated.get("amount_paid"))));

        ReminderService.NotifyDelivery receipt = null;
        if (paid != null && paid.signum() > 0) {
            String note = "Membership renewal"
                + (discount.any() ? "\n\n" + discount.note() : "");
            paymentDao.insert(id, paid, Dates.todayStr(), mode == null ? "Cash" : mode, note,
                PaymentContext.membership(type, base, newExpiry)
                    .withDiscount(discount.any() ? discount.amount() : null));
            receipt = reminderService.sendRenewalReceipt(updated, paid.toPlainString(),
                mode == null ? "Cash" : mode, newExpiry);
        }
        if (discount.any()) {
            referralService.redeem(discount);
        }
        // Settle the other direction too: this renewal may be the payment that
        // finally clears the dues of someone who was themselves referred.
        referralService.settleForMember(id);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", "Membership renewed for " + updated.get("name") + " until " + newExpiry + "."
            + (discount.any() ? " Referral reward of ₹" + discount.amount().stripTrailingZeros().toPlainString()
                + " applied." : "")
            + (due.signum() > 0 ? " Amount due: ₹" + due.toPlainString() + "." : " Fully paid."));
        res.put("member", updated);
        res.put("amount_due", due);
        res.put("referral_discount", discount.any() ? discount.amount() : BigDecimal.ZERO);
        res.put("referral_note", discount.any() ? discount.note() : null);
        res.put("receipt", receipt == null ? null : Map.of("delivered", receipt.delivered(), "recipient", receipt.recipient()));
        return res;
    }

    @Override
    public Map<String, Object> renumber(Long id, Map<String, Object> body) {
        Map<String, Object> member = requireMember(id);
        String codeError = validateMemberCode(Body.str(body, "member_code"));
        if (codeError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, codeError);
        String newCode = String.valueOf(body.get("member_code")).trim();
        if (newCode.equals(String.valueOf(member.get("member_code")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "New Member ID is the same as the current one");
        }
        Optional<Map<String, Object>> dup = clientDao.findByMemberCodeExcept(newCode, id);
        if (dup.isPresent()) {
            throw new BusinessException(HttpStatus.CONFLICT,
                "Member ID " + newCode + " is already taken by " + dup.get().get("name") + ".");
        }
        String oldCode = String.valueOf(member.get("member_code"));
        Integer attendanceUpdated = tx.execute(status -> {
            clientDao.updateMemberCode(id, newCode);
            // The old number goes back to the queue, the new one is theirs.
            clientDao.releaseMemberCode(oldCode);
            clientDao.claimMemberCode(newCode, id);
            return clientDao.cascadeAttendanceCode(oldCode, newCode);
        });
        Map<String, Object> renamed = new LinkedHashMap<>(member);
        renamed.put("member_code", newCode);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", "Member " + member.get("name") + " renumbered from " + oldCode + " to " + newCode + ".");
        res.put("member", renamed);
        res.put("attendance_updated", attendanceUpdated);
        return res;
    }

    @Override
    public Map<String, Object> freeze(Long id, Map<String, Object> body) {
        Map<String, Object> member = requireMember(id);
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot freeze " + member.get("name") + " — the membership is " + member.get("status") + ".");
        }
        int n = Body.toInt(body.get("days"));
        if (n < 1 || n > 365) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Freeze days must be between 1 and 365");
        }
        if (member.get("frozen_until") != null
            && String.valueOf(member.get("frozen_until")).compareTo(Dates.todayStr()) >= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                member.get("name") + " is already frozen until " + member.get("frozen_until") + ".");
        }
        if (member.get("membership_expiry") != null
            && String.valueOf(member.get("membership_expiry")).compareTo(Dates.todayStr()) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot freeze " + member.get("name") + " — the membership has already expired. Renew it first.");
        }
        String freezeUntil = Dates.addDays(Dates.todayStr(), n);
        String newExpiry = member.get("membership_expiry") != null
            ? Dates.addDays(String.valueOf(member.get("membership_expiry")), n) : null;
        String reason = Body.str(body, "reason");
        Map<String, Object> updated = clientDao.freeze(id, freezeUntil, reason == null ? null : reason.trim(), newExpiry);
        clientDao.logEvent(id, "freeze",
            "Frozen for " + n + " day(s) until " + freezeUntil + ". Expiry moved to " + newExpiry + "."
                + (reason != null ? " Reason: " + reason : ""));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", updated.get("name") + " is frozen until " + freezeUntil
            + ". Expiry auto-adjusted to " + newExpiry + ".");
        res.put("member", updated);
        return res;
    }

    @Override
    public Map<String, Object> resume(Long id) {
        Map<String, Object> member = requireMember(id);
        if (member.get("frozen_until") == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, member.get("name") + " is not frozen.");
        }
        Map<String, Object> updated = clientDao.resume(id);
        clientDao.logEvent(id, "resume",
            "Frozen period ended. Membership active until " + updated.get("membership_expiry") + ".");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", updated.get("name") + " resumed — the gate is open again. Expiry remains "
            + updated.get("membership_expiry") + ".");
        res.put("member", updated);
        return res;
    }

    @Override
    public Map<String, Object> upgrade(Long id, Map<String, Object> body) {
        Map<String, Object> member = requireMember(id);
        String newType = String.valueOf(body.get("membership_type") == null ? "" : body.get("membership_type")).trim();
        if (!PlanCatalog.isKnownPlan(newType)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                PlanCatalog.planError("membership_type"));
        }
        if (newType.equals(String.valueOf(member.get("membership_type")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                member.get("name") + " is already on the " + newType + " plan.");
        }
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot upgrade " + member.get("name") + " — the membership is " + member.get("status") + ".");
        }
        BigDecimal paid = Body.toNonNeg(body, "amount");
        if (Body.isNan(paid)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount must be a non-negative number");
        }
        String mode = Body.str(body, "method");
        if (mode != null && !isValidPaymentMode(mode)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PAYMENT_MODE_ERROR);
        }

        int oldDays = Dates.durationDays(String.valueOf(member.get("membership_type")));
        int newDays = Dates.durationDays(newType);
        int diff = newDays - oldDays;
        String base = member.get("membership_expiry") != null
            && String.valueOf(member.get("membership_expiry")).compareTo(Dates.todayStr()) >= 0
            ? String.valueOf(member.get("membership_expiry")) : Dates.todayStr();
        String newExpiry = diff > 0 ? Dates.addDays(base, diff) : base;

        Map<String, Object> updated = clientDao.upgrade(id, newType, newExpiry);

        ReminderService.NotifyDelivery receipt = null;
        if (paid != null && paid.signum() > 0) {
            paymentDao.insert(id, paid, Dates.todayStr(), mode == null ? "Cash" : mode, "Plan upgrade",
                PaymentContext.membership(newType, Body.str(member, "membership_start"), newExpiry));
            receipt = reminderService.sendRenewalReceipt(updated, paid.toPlainString(),
                mode == null ? "Cash" : mode, newExpiry);
        }
        clientDao.logEvent(id, "upgrade", "Upgraded " + member.get("membership_type") + " → " + newType
            + ". Expiry " + member.get("membership_expiry") + " → " + newExpiry
            + (diff > 0 ? " (+" + diff + " days)." : " (unchanged)."));

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", updated.get("name") + " upgraded to " + newType + ". New expiry: " + newExpiry
            + (diff > 0 ? " (+" + diff + " days)." : " (expiry unchanged — you never lose paid time)."));
        res.put("member", updated);
        res.put("new_expiry", newExpiry);
        res.put("receipt", receipt == null ? null : Map.of("delivered", receipt.delivered(), "recipient", receipt.recipient()));
        return res;
    }

    @Override
    public Map<String, Object> cancel(Long id, Map<String, Object> body) {
        Map<String, Object> member = requireMember(id);
        String effective = "now".equals(body.get("effective")) ? "now"
            : "expiry".equals(body.get("effective")) ? "expiry" : null;
        if (effective == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "effective must be 'now' or 'expiry'");
        }
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                member.get("name") + " is already " + member.get("status") + ".");
        }
        Map<String, Object> res = new LinkedHashMap<>();
        if ("now".equals(effective)) {
            Map<String, Object> updated = clientDao.cancelNow(id);
            clientDao.logEvent(id, "cancel", "Cancelled with immediate effect — access ended, gate locked.");
            res.put("message", updated.get("name") + " cancelled — access ended immediately and the gate is locked.");
            res.put("member", updated);
        } else {
            Map<String, Object> updated = clientDao.cancelAtExpiry(id);
            clientDao.logEvent(id, "cancel", "Cancelled with effect at expiry (" + updated.get("membership_expiry")
                + ") — access continues until then, auto-renew disabled.");
            res.put("message", updated.get("name") + " will keep access until " + updated.get("membership_expiry")
                + ", then the membership ends. Auto-renew is off.");
            res.put("member", updated);
        }
        return res;
    }

    @Override
    public Map<String, Object> purge(Long id) {
        Map<String, Object> member = requireMember(id);
        String code = String.valueOf(member.get("member_code"));
        String name = String.valueOf(member.get("name"));
        // Deactivate first, delete second: it makes the destructive step
        // deliberate, and it means a mis-click on a live member costs nothing.
        if ("active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                name + " is still active. Deactivate the membership first, then delete it"
                    + " permanently if that is really what you want.");
        }

        Map<String, Integer> removed = tx.execute(status -> {
            Map<String, Integer> counts = clientDao.purge(id, code);
            // The number goes back to the front of the queue.
            clientDao.releaseMemberCode(code);
            return counts;
        });

        audit.record("delete", "members", id, "Deleted " + name + " (ID " + code
            + ") permanently — Member ID " + code + " is free again");

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", name + " deleted permanently. Member ID " + code
            + " is free and will be offered to the next admission.");
        res.put("member_code", code);
        res.put("removed", removed);
        return res;
    }

    @Override
    public Map<String, Object> deactivate(Long id) {
        requireMember(id);
        return clientDao.findById(id)
            .map(m -> {
                clientDao.deactivate(id);
                return clientDao.findById(id).orElse(m);
            })
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
    }

    // ------------------------------------------------------ fingerprint lifecycle

    @Override
    public Map<String, Object> enrollFingerprint(Long id) {
        Map<String, Object> member = requireMember(id);
        clientDao.updateFingerprintStatus(id, "pending");
        log.info("Fingerprint enrollment requested for {} ({}) — data sent to machine.",
            member.get("member_code"), member.get("name"));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", member.get("name")
            + " was sent to the machine — ask them to scan their fingerprint at the terminal.");
        res.put("member_code", member.get("member_code"));
        res.put("fingerprint_status", "pending");
        return res;
    }

    @Override
    public Map<String, Object> markFingerprintEnrolled(Long id) {
        Map<String, Object> member = requireMember(id);
        clientDao.updateFingerprintStatus(id, "enrolled");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", member.get("name")
            + " is enrolled — the fingerprint opens the gate while the membership is active.");
        res.put("fingerprint_status", "enrolled");
        return res;
    }

    @Override
    public Map<String, Object> disableFingerprint(Long id) {
        Map<String, Object> member = requireMember(id);
        clientDao.updateFingerprintStatus(id, "not_enrolled");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", member.get("name") + " — fingerprint removed from the machine.");
        res.put("fingerprint_status", "not_enrolled");
        return res;
    }

    // ------------------------------------------------------------------ helpers

    private Map<String, Object> requireMember(Long id) {
        return clientDao.findById(id)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
    }

    private String validateDates(Map<String, Object> body) {
        for (String field : DATE_FIELDS) {
            Object v = body.get(field);
            if (v != null && !Dates.isValidDateString(String.valueOf(v))) {
                return field + " must be a valid date in YYYY-MM-DD format";
            }
        }
        // A membership that ends before it starts is not a membership. The
        // format check above passed both dates individually, so nothing else
        // was looking at them together — the row went in and every expiry
        // calculation downstream read it as already lapsed.
        String start = Body.str(body, "membership_start");
        String expiry = Body.str(body, "membership_expiry");
        if (start != null && expiry != null && expiry.compareTo(start) < 0) {
            return "The membership cannot expire (" + Dates.friendly(expiry)
                + ") before it starts (" + Dates.friendly(start) + ").";
        }
        String dob = Body.str(body, "dob");
        if (dob != null && !dob.isBlank()) {
            String today = Dates.todayStr();
            if (dob.compareTo(today) > 0) {
                return "The date of birth cannot be in the future.";
            }
            if (dob.compareTo(Dates.addDays(today, -MAX_AGE_DAYS)) < 0) {
                return "Check the date of birth — that would make this member over "
                    + (MAX_AGE_DAYS / 365) + " years old.";
            }
        }
        return null;
    }

    /**
     * Phone and email, checked for shape rather than existence.
     *
     * <p>These are the only ways the gym can reach a member about an expiry or
     * a due, and "abcdefghij" passed straight through into the reminder queue
     * where it silently failed for ever.
     */
    private String validateContact(Map<String, Object> body, boolean phoneRequired) {
        String phoneError = Contacts.phoneError(Body.str(body, "phone"), phoneRequired);
        return phoneError != null ? phoneError : Contacts.emailError(Body.str(body, "email"));
    }

    /**
     * Money that adds up. Paying more than the fee left amount_paid above
     * membership_fee, so the dashboard's collected total was overstated and
     * the member's own portal showed a fee smaller than what it said they had
     * paid.
     */
    /**
     * The guard for an EDIT, as opposed to a create.
     *
     * <p>An edit may carry one half of a pair — just the fee, just the expiry —
     * so each rule is applied to the value being written if there is one and the
     * value already stored if there is not. Checking only what the body contains
     * is how "expiry before start" stayed reachable on a member whose start date
     * was never re-sent, and how a non-numeric fee reached the DAO as a null and
     * came back to the desk as HTTP 500.
     */
    private String validateEffectiveUpdate(Map<String, Object> current, Map<String, Object> body) {
        BigDecimal fee = current(current, body, "membership_fee");
        BigDecimal paid = current(current, body, "amount_paid");
        if (body.containsKey("membership_fee") && Body.isNan(Body.toNonNeg(body, "membership_fee"))) {
            return "membership_fee must be a non-negative number";
        }
        if (body.containsKey("amount_paid") && Body.isNan(Body.toNonNeg(body, "amount_paid"))) {
            return "amount_paid must be a non-negative number";
        }
        if (fee != null && fee.signum() < 0) return "membership_fee must be a non-negative number";
        if (paid != null && paid.signum() < 0) return "amount_paid must be a non-negative number";
        String moneyError = validateMoney(fee, paid);
        if (moneyError != null) return moneyError;

        String start = effectiveStr(current, body, "membership_start");
        String expiry = effectiveStr(current, body, "membership_expiry");
        if (start != null && expiry != null && !start.isBlank() && !expiry.isBlank()
            && expiry.compareTo(start) < 0) {
            return "The membership cannot expire (" + Dates.friendly(expiry)
                + ") before it starts (" + Dates.friendly(start) + ").";
        }
        return null;
    }

    /** The number being written if the body carries one, else the number already stored. */
    private BigDecimal current(Map<String, Object> current, Map<String, Object> body, String field) {
        if (body.containsKey(field) && body.get(field) != null
            && !"".equals(String.valueOf(body.get(field)))) {
            return Body.toDecimal(body.get(field));
        }
        return toDecimalOr0(current.get(field));
    }

    /** As above, for dates. */
    private String effectiveStr(Map<String, Object> current, Map<String, Object> body, String field) {
        if (body.containsKey(field) && body.get(field) != null
            && !"".equals(String.valueOf(body.get(field)))) {
            return Body.str(body, field);
        }
        Object v = current.get(field);
        return v == null ? null : String.valueOf(v);
    }

    private String validateMoney(BigDecimal fee, BigDecimal paid) {
        if (fee == null || paid == null) {
            return null;
        }
        if (paid.compareTo(fee) > 0) {
            return "Amount paid (\u20b9" + paid.toPlainString() + ") is more than the membership fee (\u20b9"
                + fee.toPlainString() + "). Record the extra as a separate payment if it is an advance.";
        }
        return null;
    }

    /** ~120 years. Anything older is a typo, not a member. */
    private static final int MAX_AGE_DAYS = 120 * 365;
    private static final int MIN_NAME_LENGTH = 2;

    private String validateMemberCode(String raw) {
        String code = raw == null ? "" : String.valueOf(raw).trim();
        if (code.isEmpty()) return "Member ID is required";
        if (!code.matches("\\d+")) return "Member ID must contain numbers only";
        if (code.length() > 20) return "Member ID is too long (max 20 digits)";
        return null;
    }

    private String validateCardUid(String raw) {
        String uid = normalizeCardUid(raw);
        if (uid == null || uid.isEmpty()) return null;
        if (!uid.matches("[A-Z0-9]+")) return "Card UID can only contain letters and numbers";
        if (uid.length() > 50) return "Card UID is too long (max 50 characters)";
        return null;
    }

    private String normalizeCardUid(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        return raw.trim().replaceAll("[\\s-]+", "").toUpperCase();
    }

    private String fingerprintStatusFromToggle(boolean activate, String current) {
        if (activate) return "enrolled".equals(current) ? "enrolled" : "pending";
        return "not_enrolled";
    }

    private static boolean isValidPaymentMode(String value) {
        if (value == null || value.isEmpty()) return true;
        return List.of("Cash", "UPI", "Card", "Bank Transfer", "Online").contains(value.trim());
    }

    private static BigDecimal max0(BigDecimal v) {
        return v.signum() < 0 ? BigDecimal.ZERO : v;
    }

    private static BigDecimal toDecimalOr0(Object v) {
        BigDecimal d = Body.toDecimal(v);
        return d == null ? BigDecimal.ZERO : d;
    }
}
