package com.gymos.payment.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Payments data access — rows as column maps matching the Node pg output.
 * All SQL lives in {@link com.gymos.payment.dao.impl.PaymentDaoImpl}.
 */
public interface PaymentDao {

    List<Map<String, Object>> findAll(Long memberId);

    Optional<Map<String, Object>> findById(Long id);

    /**
     * Writes one row into the ledger. The context is what the money bought —
     * see {@link PaymentContext}; without it a receipt can only guess.
     */
    Map<String, Object> insert(Long memberId, BigDecimal amount, String paymentDate, String method,
                               String note, PaymentContext context);

    /** A recorded payment reduces the member's outstanding balance (never below 0). */
    void reduceDue(Long memberId, BigDecimal amount);

    /** Members with an effective outstanding balance (amount_due or fee − paid > 0). */
    List<Map<String, Object>> membersWithDues();

    /** Mark a member fully paid for the current period. */
    void clearDues(Long memberId, String mode);

    int delete(Long id);

    BigDecimal sumToday();

    BigDecimal sumMonth();
}
