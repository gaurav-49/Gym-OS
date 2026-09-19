package com.gymos.member.service;

import java.util.List;
import java.util.Map;

/**
 * Member (client) service — business rules for the /clients endpoints,
 * ported from clientController.js. Persistence is delegated to ClientDao;
 * every validation/message/status matches the Node backend.
 */
public interface MemberService {

    List<Map<String, Object>> listAll();

    Map<String, Object> get(Long id);

    /** The next free numeric Member ID — a suggestion for the onboarding form. */
    Long nextMemberCode();

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> deactivate(Long id);

    /**
     * Removes a member permanently, and gives their Member ID back.
     *
     * <p>Deactivating keeps the record and the ID with it — a member who comes
     * back is still the same number. This is the other thing: the record goes,
     * and the number returns to the front of the queue for the next admission.
     * Guarded to inactive members so an active one cannot go by accident.
     */
    Map<String, Object> purge(Long id);

    Map<String, Object> renew(Long id, Map<String, Object> body);

    Map<String, Object> renumber(Long id, Map<String, Object> body);

    List<Map<String, Object>> events(Long id);

    Map<String, Object> freeze(Long id, Map<String, Object> body);

    Map<String, Object> resume(Long id);

    Map<String, Object> upgrade(Long id, Map<String, Object> body);

    Map<String, Object> cancel(Long id, Map<String, Object> body);

    Map<String, Object> enrollFingerprint(Long id);

    Map<String, Object> markFingerprintEnrolled(Long id);

    Map<String, Object> disableFingerprint(Long id);
}
