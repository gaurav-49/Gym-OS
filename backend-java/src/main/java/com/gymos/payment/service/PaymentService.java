package com.gymos.payment.service;

import java.util.List;
import java.util.Map;

/**
 * Payments business rules (port of paymentsController.js). The payment ledger
 * writes used by member onboarding/renewal/upgrade go through PaymentDao
 * directly; this service owns the /payments endpoints.
 */
public interface PaymentService {

    List<Map<String, Object>> list(Long memberId);

    Map<String, Object> create(Long memberId, String amount, String paymentDate, String method, String note);

    Map<String, Object> collectDue(Long memberId, String method);

    Map<String, Object> collectAll(String method);

    void delete(Long id);
}
