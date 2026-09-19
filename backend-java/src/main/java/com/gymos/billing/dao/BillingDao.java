package com.gymos.billing.dao;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Recurring-billing data access — billing_attempts bookkeeping, client renewal
 * writes and the overview queries. All SQL lives in
 * {@link com.gymos.billing.dao.impl.BillingDaoImpl}.
 */
public interface BillingDao {

    Optional<Map<String, Object>> findClientById(Long id);

    List<Map<String, Object>> findDueMembers(int daysBefore);

    Optional<Map<String, Object>> findAttempt(Long memberId, String cycle);

    void upsertAttempt(Long memberId, String cycle, BigDecimal amount, String method, String status,
                       int attemptCount, Timestamp nextRetryAt, String error, Timestamp settledAt);

    /** Renew a client: extend expiry, mark paid, save the recurring method. */
    Map<String, Object> renewClient(Long id, String newExpiry, BigDecimal fee, String method);

    int pauseClient(Long id);

    int cancelPendingRetries(Long memberId);

    Map<String, Object> updateMemberBilling(Long id, Boolean autoRenew, String recurringMethod);

    List<Map<String, Object>> billingMembers();

    List<Map<String, Object>> pendingRetries();

    List<Map<String, Object>> dunningLog();

    Map<String, Object> billingStats();
}
