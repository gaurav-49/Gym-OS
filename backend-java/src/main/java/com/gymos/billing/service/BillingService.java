package com.gymos.billing.service;

import java.util.Map;

/**
 * Recurring / auto-renew billing — port of billingService.js: settings,
 * the charge attempt (with retry + dunning), the hourly job, and the staff
 * actions (retry now, mark paid, pause, set member billing, overview).
 */
public interface BillingService {

    Map<String, Object> getSettings();

    Map<String, Object> saveSettings(Map<String, Object> input);

    Map<String, Object> runAutoRenewCheck();

    Map<String, Object> retryMember(Long memberId);

    Map<String, Object> markPaid(Long memberId, String amount, String method);

    Map<String, Object> pauseMember(Long memberId);

    Map<String, Object> setMemberBilling(Long memberId, Map<String, Object> body);

    Map<String, Object> getOverview();
}
