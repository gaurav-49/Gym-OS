package com.gymos.portal.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Member self-service portal data access — the aggregated profile query plus
 * the member's workout/diet/progress/attendance/payments history. All SQL lives
 * in {@link com.gymos.portal.dao.impl.MemberPortalDaoImpl}.
 */
public interface MemberPortalDao {

    Optional<Map<String, Object>> findPortalMember(Long id);

    /** Persist the member's light/dark choice. Null means follow the device. */
    void updateThemePreference(Long id, String theme);

    List<Map<String, Object>> listWorkouts(Long memberId);

    List<Map<String, Object>> listDiet(Long memberId);

    List<Map<String, Object>> listProgress(Long memberId, int limit);

    List<Map<String, Object>> listAttendance(Long memberId, int limit);

    List<Map<String, Object>> listPayments(Long memberId, int limit);

    /**
     * The member's assigned trainer, with the contact details a member is
     * entitled to see. Empty when nobody is assigned — which is what decides
     * whether the portal shows a Personal Training tab at all.
     */
    Optional<Map<String, Object>> findTrainer(Long memberId);

    /** Personal-training packages this member has bought, newest first. */
    List<Map<String, Object>> listPtSubscriptions(Long memberId);

    /** Sessions actually delivered against those packages. */
    List<Map<String, Object>> listPtSessions(Long memberId, int limit);

    /** The locker this member holds, if any — one per member. */
    Optional<Map<String, Object>> findLocker(Long memberId);

    /** Their own invoices, newest first, each with its line items. */
    List<Map<String, Object>> listInvoices(Long memberId, int limit);

    /** Set (or replace) a member's portal password and clear any forced reset. */
    void setPassword(Long memberId, String passwordHash);

    /** Require a new password before this member can sign in again. */
    void setMustResetPassword(Long memberId, boolean mustReset);
}
