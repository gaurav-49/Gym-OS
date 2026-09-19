package com.gymos.referrals.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Member-get-member referrals and their rewards. */
public interface ReferralDao {

    List<Map<String, Object>> findReferrals(Long referrerId, String status, int limit);

    Optional<Map<String, Object>> findById(Long id);

    Map<String, Object> insert(Long referrerId, String referredName, String referredPhone, String referredEmail,
                               Long leadId, String rewardType, BigDecimal rewardValue, String notes,
                               Long createdBy);

    Map<String, Object> update(Long id, String status, Long convertedMemberId, String rewardType,
                               BigDecimal rewardValue, String notes, boolean payingReward);

    Optional<Map<String, Object>> delete(Long id);

    /** The member behind a referral code, for "who sent you?" at the desk. */
    Optional<Map<String, Object>> findByReferralCode(String code);

    Optional<Map<String, Object>> findMember(Long memberId);

    /** Extends a membership by N days — how a "days" reward is actually paid. */
    Map<String, Object> extendMembership(Long memberId, int days);

    /** Per-referrer totals for the leaderboard on the Referrals page. */
    List<Map<String, Object>> topReferrers(int limit);

    Map<String, Object> counts();

    /** The gym's current referral offer, from the settings table. */
    Map<String, String> rewardSettings();

    // ── The reward lifecycle: earned on a paid-up conversion, spent on a renewal ──

    /** A referrer's open invitation to this phone number, if there is one. */
    Optional<Map<String, Object>> findOpenInviteByPhone(Long referrerId, String phone);

    /** The referral that brought this member in, whatever state it is in. */
    Optional<Map<String, Object>> findByConvertedMember(Long memberId);

    /** Rewards this member has earned and not yet spent, oldest first. */
    List<Map<String, Object>> findUnredeemedRewards(Long referrerId);

    /** Mark rewards as spent on a renewal. */
    void markRedeemed(List<Long> referralIds);

    /** Record who introduced a member — set once, at onboarding. */
    void setReferredBy(Long memberId, Long referrerId);
}
