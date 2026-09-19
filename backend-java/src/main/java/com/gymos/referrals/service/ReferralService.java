package com.gymos.referrals.service;

import java.util.List;
import java.util.Map;

/**
 * Member-get-member referrals.
 *
 * <p>Word of mouth is how most gyms actually grow, and 1.0 had nowhere to record
 * it — a referred walk-in became an ordinary lead and the member who sent them
 * was never thanked. A referral pays out only once the person it named becomes
 * a paying member, not when the lead is created.
 */
public interface ReferralService {

    List<Map<String, Object>> list(Long referrerId, String status, String limit);

    /** Counts plus the top referrers, for the page header. */
    Map<String, Object> summary(String limit);

    /** Who owns a referral code — "who sent you?" at the front desk. */
    Map<String, Object> lookupCode(String code);

    Map<String, Object> create(Map<String, Object> body, Long createdBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    /** Marks the referral converted and links the member who joined. */
    Map<String, Object> markJoined(Long id, Map<String, Object> body);

    /** Pays the reward — extra days on the referrer's membership, or a recorded credit. */
    Map<String, Object> payReward(Long id);

    Map<String, Object> delete(Long id);

    /**
     * Everything the member portal's Referrals tab shows: the member's own
     * code and share link, the offer in words, and how their invitations are
     * doing. Never exposes another member's details.
     */
    java.util.Map<String, Object> memberSummary(Long memberId);

    /** A member inviting someone from their own portal. */
    java.util.Map<String, Object> inviteFromPortal(Long memberId, java.util.Map<String, Object> body);

    // ── The reward loop ──────────────────────────────────────────────────

    /**
     * Link a member who arrived with someone's referral code, at onboarding.
     * Matches an invitation the referrer already recorded for that phone
     * number, or creates the record if they never got round to it.
     *
     * @throws com.gymos.common.api.BusinessException 400 when the code matches nobody
     */
    void linkNewMember(Long newMemberId, String referralCode, String phone, String name);

    /**
     * Resolve a referral code to its owner, or fail.
     *
     * <p>Exists so onboarding can reject a mistyped code <em>before</em> it
     * creates the member. Validating afterwards left a member created, paid
     * and then a 400 on screen, so the desk retried and was told the Member ID
     * was already taken.
     *
     * @throws com.gymos.common.api.BusinessException 400 when nothing owns the code
     */
    java.util.Map<String, Object> requireReferrer(String referralCode);

    /**
     * Pay out the referrer once this member has settled up in full. Safe to
     * call after any payment: it does nothing unless there is an unpaid reward
     * and the dues really are clear.
     */
    void settleForMember(Long memberId);

    /** What a member's earned-but-unspent rewards are worth right now. */
    record Discount(java.math.BigDecimal amount, java.util.List<Long> referralIds, String note) {
        public boolean any() {
            return amount != null && amount.signum() > 0;
        }
    }

    /**
     * The discount to take off a renewal, capped at what is being charged.
     * Nothing is marked spent until {@link #redeem} is called, so a renewal
     * that fails validation does not silently burn a member's rewards.
     */
    Discount pendingDiscount(Long memberId, java.math.BigDecimal fee);

    /** Mark a discount as spent, once the renewal has actually gone through. */
    void redeem(Discount discount);
}
