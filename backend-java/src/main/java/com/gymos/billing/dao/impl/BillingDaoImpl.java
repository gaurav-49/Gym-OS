package com.gymos.billing.dao.impl;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.billing.dao.BillingDao;

@Repository
public class BillingDaoImpl implements BillingDao {

    private final JdbcTemplate jdbc;

    public BillingDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String CLIENT_COLS = """
        id, member_code, name, email, phone, membership_type, membership_expiry,
        membership_fee, amount_paid, amount_due, payment_mode, recurring_method, auto_renew, status""";

    @Override
    public Optional<Map<String, Object>> findClientById(Long id) {
        return jdbc.queryForList(
            "SELECT " + CLIENT_COLS + " FROM clients WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> findDueMembers(int daysBefore) {
        return jdbc.queryForList("""
            SELECT id, member_code, name, email, phone, membership_type, membership_expiry,
                   membership_fee, amount_paid, recurring_method, auto_renew
            FROM clients
            WHERE status = 'active'
              AND auto_renew = TRUE
              AND membership_expiry IS NOT NULL
              AND membership_expiry <= CURRENT_DATE + make_interval(days => ?)
            ORDER BY membership_expiry""", daysBefore);
    }

    @Override
    public Optional<Map<String, Object>> findAttempt(Long memberId, String cycle) {
        return jdbc.queryForList(
            "SELECT * FROM billing_attempts WHERE member_id = ? AND cycle = ?", memberId, cycle)
            .stream().findFirst();
    }

    @Override
    public void upsertAttempt(Long memberId, String cycle, BigDecimal amount, String method, String status,
                              int attemptCount, Timestamp nextRetryAt, String error, Timestamp settledAt) {
        jdbc.update("""
            INSERT INTO billing_attempts (member_id, cycle, amount, method, status, attempt_count,
                                          next_retry_at, error, settled_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (member_id, cycle) DO UPDATE SET
                amount = EXCLUDED.amount,
                method = EXCLUDED.method,
                status = EXCLUDED.status,
                attempt_count = EXCLUDED.attempt_count,
                next_retry_at = EXCLUDED.next_retry_at,
                error = EXCLUDED.error,
                settled_at = EXCLUDED.settled_at""",
            memberId, cycle, amount, method, status, attemptCount, nextRetryAt, error, settledAt);
    }

    /**
     * `fee` here is the amount actually collected, which on a partial payment is
     * less than the plan fee. amount_due used to be hardcoded to 0, so a
     * collection whose own receipt read "Amount due: ₹700.00" stored a balance of
     * zero and the member dropped off Outstanding Dues still owing ₹700. The
     * balance is now derived from the plan fee, so the number stored is the number
     * reported.
     *
     * recurring_method only fills a blank. Overwriting it replaced a method the
     * operator had chosen with whatever was used for one manual collection
     * (auto_renew is the actual enrolment flag and is left alone either way).
     */
    @Override
    public Map<String, Object> renewClient(Long id, String newExpiry, BigDecimal fee, String method) {
        return jdbc.queryForMap("""
            UPDATE clients
            SET membership_expiry = ?, status = 'active',
                amount_paid = ?,
                amount_due  = GREATEST(0, COALESCE(membership_fee, 0) - ?),
                payment_mode = ?,
                recurring_method = COALESCE(recurring_method, ?)
            WHERE id = ? RETURNING *""", newExpiry, fee, fee, method, method, id);
    }

    @Override
    public int pauseClient(Long id) {
        return jdbc.update("UPDATE clients SET auto_renew = FALSE WHERE id = ?", id);
    }

    @Override
    public int cancelPendingRetries(Long memberId) {
        return jdbc.update(
            "UPDATE billing_attempts SET next_retry_at = NULL WHERE member_id = ? AND status = 'failed'",
            memberId);
    }

    @Override
    public Map<String, Object> updateMemberBilling(Long id, Boolean autoRenew, String recurringMethod) {
        return jdbc.queryForMap("""
            UPDATE clients SET
                auto_renew = COALESCE(?, auto_renew),
                recurring_method = CASE WHEN ?::text IS NOT NULL THEN ? ELSE recurring_method END
            WHERE id = ? RETURNING *""", autoRenew, recurringMethod, recurringMethod, id);
    }

    @Override
    public List<Map<String, Object>> billingMembers() {
        return jdbc.queryForList("""
            SELECT c.id, c.member_code, c.name, c.phone, c.email, c.membership_type,
                   c.membership_expiry, c.membership_fee, c.amount_paid, c.recurring_method,
                   c.auto_renew, c.status,
                   b.status AS attempt_status, b.attempt_count, b.next_retry_at, b.error, b.cycle
            FROM clients c
            LEFT JOIN LATERAL (
                SELECT * FROM billing_attempts ba WHERE ba.member_id = c.id ORDER BY ba.id DESC LIMIT 1
            ) b ON TRUE
            WHERE c.auto_renew = TRUE
               OR EXISTS (SELECT 1 FROM billing_attempts ba2 WHERE ba2.member_id = c.id)
            ORDER BY c.auto_renew DESC, c.membership_expiry, c.name""");
    }

    @Override
    public List<Map<String, Object>> pendingRetries() {
        return jdbc.queryForList("""
            SELECT b.id, b.member_id, b.cycle, b.amount, b.method, b.attempt_count, b.next_retry_at, b.error,
                   c.name AS member_name, c.member_code, c.membership_fee, c.recurring_method, c.membership_expiry
            FROM billing_attempts b
            JOIN clients c ON c.id = b.member_id
            WHERE b.status = 'failed' AND b.next_retry_at IS NOT NULL
            ORDER BY b.next_retry_at, b.id""");
    }

    @Override
    public List<Map<String, Object>> dunningLog() {
        return jdbc.queryForList("""
            SELECT l.*, c.name AS member_name
            FROM notification_log l
            LEFT JOIN clients c ON c.id = l.member_id
            WHERE l.kind = 'dunning'
            ORDER BY l.id DESC LIMIT 50""");
    }

    @Override
    public Map<String, Object> billingStats() {
        return jdbc.queryForMap("""
            SELECT
                (SELECT COUNT(*)::int FROM clients WHERE auto_renew = TRUE) AS auto_renew_count,
                (SELECT COUNT(*)::int FROM billing_attempts WHERE status = 'success'
                    AND settled_at >= NOW() - INTERVAL '30 days') AS renewed_30d,
                (SELECT COUNT(*)::int FROM billing_attempts WHERE status = 'failed') AS failed_attempts,
                (SELECT COUNT(*)::int FROM billing_attempts WHERE status = 'failed'
                    AND next_retry_at IS NOT NULL) AS pending_retries""");
    }
}
