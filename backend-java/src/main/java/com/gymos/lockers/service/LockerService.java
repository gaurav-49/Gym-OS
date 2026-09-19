package com.gymos.lockers.service;

import java.util.List;
import java.util.Map;

/**
 * Locker management. A locker is {@code free}, {@code occupied} (assigned to a
 * member) or {@code maintenance} (out of service), and the transitions between
 * those states are guarded so a member's belongings never fall out of the record.
 */
public interface LockerService {

    List<Map<String, Object>> list(String status, String search);

    Map<String, Object> create(Map<String, Object> body);

    /** Edit the locker itself — not who holds it. Use assign/release for that. */
    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> assign(Long id, Map<String, Object> body);

    /**
     * Assigns a locker <em>by number</em>, creating it if the gym has not
     * recorded it yet — what the member onboarding form calls when the desk
     * ticks "assign a locker" and types a number.
     *
     * <p>Same guards, same money, same audit trail as {@link #assign}: a locker
     * taken at the desk during signup and one taken from the Lockers page are
     * the same event, and the two screens must not be able to disagree about
     * what happened.
     */
    Map<String, Object> assignByNumber(Long memberId, Map<String, Object> body);

    /** Gives up whatever locker this member holds. Silent when they hold none. */
    Map<String, Object> releaseHeldBy(Long memberId);

    Map<String, Object> release(Long id);

    Map<String, Object> delete(Long id);
}
