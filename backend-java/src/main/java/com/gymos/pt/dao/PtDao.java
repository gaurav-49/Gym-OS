package com.gymos.pt.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Personal training: packages, subscriptions, delivered sessions, commissions. */
public interface PtDao {

    // ---- packages ----

    List<Map<String, Object>> findPackages(boolean activeOnly);

    Optional<Map<String, Object>> findPackageById(Long id);

    Optional<Map<String, Object>> findPackageByName(String name);

    /**
     * @param planType how long the plan runs (Monthly / Quarterly / …)
     * @param sessions an optional cap; null means unlimited for the duration
     */
    Map<String, Object> insertPackage(String name, String planType, Integer sessions, BigDecimal price,
                                      int validityDays,
                                      BigDecimal commissionPercent);

    Optional<Map<String, Object>> updatePackage(Long id, String name, String planType, Integer sessions,
                                               BigDecimal price,
                                                Integer validityDays, BigDecimal commissionPercent,
                                                Boolean isActive);

    void deletePackage(Long id);

    int countSubscriptionsOf(Long packageId);

    // ---- subscriptions ----

    List<Map<String, Object>> findSubscriptions(Long memberId, Long trainerId, String status);

    /** Locked for update, joined to member and package, for the session burn. */
    Optional<Map<String, Object>> lockSubscription(Long id);

    Optional<Map<String, Object>> findSubscriptionById(Long id);

    /** The member's live package, if any — only one may be active at a time. */
    Optional<Map<String, Object>> findActiveSubscription(Long memberId);

    Map<String, Object> insertSubscription(Long memberId, Long packageId, Long trainerId,
                                          // Integer, not int: null is an unlimited plan, and
                                          // unboxing it threw before the row was ever written.
                                          Integer sessionsTotal,
                                           BigDecimal price, String startDate, String expiryDate);

    Map<String, Object> updateSubscription(Long id, String status, Long trainerId);

    Map<String, Object> setSessionsUsed(Long id, int sessionsUsed, String status);

    // ---- sessions ----

    List<Map<String, Object>> findSessions(Long subscriptionId);

    Map<String, Object> insertSession(Long subscriptionId, Long trainerId, String sessionDate,
                                      String sessionTime, String notes);

    // ---- money ----

    /**
     * The PT sale in the same ledger the membership payments use, tagged with
     * the subscription it bought so its receipt shows the training term rather
     * than whatever membership the member happens to hold.
     */
    void insertPayment(Long memberId, BigDecimal amount, String paymentDate, String method, String note,
                       Long subscriptionId, String planName, String periodStart, String periodEnd);

    Map<String, Object> insertCommission(Long trainerId, Long subscriptionId, Long memberId,
                                         BigDecimal baseAmount, BigDecimal percent, BigDecimal amount,
                                         String earnedOn);

    List<Map<String, Object>> findCommissions(Long trainerId, String status);

    // ---- lookups ----

    Optional<Map<String, Object>> findMember(Long memberId);

    Optional<Map<String, Object>> findTrainer(Long trainerId);
}
