package com.gymos.pt.service;

import java.util.List;
import java.util.Map;

/**
 * Personal training: sellable session packages, a member's subscription to one,
 * the sessions burnt against it, and the trainer commission each sale earns.
 *
 * <p>1.0 could assign a trainer to a member but nothing about PT was sellable or
 * payable. Selling a package now writes the subscription, the ledger payment and
 * the trainer's commission in one transaction, and that commission flows into
 * the payroll run.
 */
public interface PtService {

    List<Map<String, Object>> listPackages(String active);

    Map<String, Object> createPackage(Map<String, Object> body);

    Map<String, Object> updatePackage(Long id, Map<String, Object> body);

    Map<String, Object> deletePackage(Long id);

    List<Map<String, Object>> listSubscriptions(Long memberId, Long trainerId, String status);

    Map<String, Object> sellSubscription(Map<String, Object> body);

    Map<String, Object> updateSubscription(Long id, Map<String, Object> body);

    /** Logs one delivered session and burns it off the balance. */
    Map<String, Object> logSession(Long subscriptionId, Map<String, Object> body);

    List<Map<String, Object>> listSessions(Long subscriptionId);

    List<Map<String, Object>> listCommissions(Long trainerId, String status);
}
