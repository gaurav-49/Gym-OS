package com.gymos.member.dao.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.member.dao.ClientDao;

/**
 * Client DAO implementation — the SQL for the members module lives here
 * (mirrors backend/src/controllers/clientController.js queries). Rows come
 * back as column maps so the API shape matches the Node pg output exactly.
 */
@Repository
public class ClientDaoImpl implements ClientDao {

    private final JdbcTemplate jdbc;

    public ClientDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String EXPIRY_STATUS_SQL = """
        CASE
            WHEN c.membership_expiry IS NULL THEN 'ok'
            WHEN c.membership_expiry < CURRENT_DATE THEN 'expired'
            WHEN c.membership_expiry <= (CURRENT_DATE + INTERVAL '30 days') THEN 'expiring'
            ELSE 'ok'
        END""";

    private static final String SELECT_WITH_TRAINER = """
        SELECT c.*, t.name AS trainer_name, %s AS expiry_status,
               COALESCE(c.amount_due, 0) AS amount_due
        FROM clients c
        LEFT JOIN users t ON t.id = c.trainer_id""".formatted(EXPIRY_STATUS_SQL);

    private static final String INSERT = """
        INSERT INTO clients (member_code, name, phone, email, address, gender, dob, join_date, membership_type,
                             membership_start, membership_expiry, membership_fee, amount_paid, amount_due,
                             payment_mode, status, trainer_id, card_uid, fingerprint_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *""";

    private static final String UPDATE = """
        UPDATE clients SET
            name = COALESCE(?, name),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            address = COALESCE(?, address),
            gender = COALESCE(?, gender),
            dob = COALESCE(?, dob),
            join_date = COALESCE(?, join_date),
            membership_type = COALESCE(?, membership_type),
            membership_start = COALESCE(?, membership_start),
            membership_expiry = COALESCE(?, membership_expiry),
            membership_fee = COALESCE(?, membership_fee),
            amount_paid = COALESCE(?, amount_paid),
            amount_due = COALESCE(?, amount_due),
            payment_mode = COALESCE(?, payment_mode),
            status = COALESCE(?, status),
            trainer_id = COALESCE(?, trainer_id),
            member_code = COALESCE(?, member_code),
            auto_renew = COALESCE(?, auto_renew),
            recurring_method = CASE WHEN ?::text IS NOT NULL THEN ?::text ELSE recurring_method END,
            card_uid = CASE WHEN ? THEN ?::text ELSE card_uid END,
            fingerprint_status = CASE WHEN ? THEN ?::text ELSE fingerprint_status END
        WHERE id = ?
        RETURNING *""";

    private static final String FREEZE = """
        UPDATE clients SET frozen_until = ?, freeze_reason = ?,
                membership_expiry = COALESCE(?, membership_expiry)
        WHERE id = ? RETURNING *""";

    private static final String RENEW = """
        UPDATE clients
        SET membership_expiry = ?, membership_type = ?, status = 'active',
            membership_fee = COALESCE(?, membership_fee),
            amount_paid = COALESCE(?, amount_paid),
            amount_due = COALESCE(?, amount_due),
            payment_mode = COALESCE(?, payment_mode)
        WHERE id = ? RETURNING *""";

    /**
     * Columns that must never leave this class.
     *
     * <p>The projections above are {@code SELECT c.*}, which is the right shape for
     * a table this wide but hands back the member's bcrypt hash with it. GET
     * /api/clients was returning 862 password hashes to anything holding a staff
     * token. Stripping here rather than enumerating forty columns means a future
     * migration cannot quietly re-open the hole by adding one more secret.
     *
     * <p>Login reads the hash through findByMemberCodeFull(), which names its
     * columns explicitly and is deliberately left alone.
     */
    private static final Set<String> SECRET_COLUMNS =
        Set.of("password_hash", "password_set_at", "must_reset_password");

    private static Map<String, Object> withoutSecrets(Map<String, Object> row) {
        if (row == null) return null;
        Map<String, Object> safe = new LinkedHashMap<>(row);
        safe.keySet().removeAll(SECRET_COLUMNS);
        return safe;
    }

    @Override
    public List<Map<String, Object>> findAllWithTrainer() {
        return jdbc.queryForList(SELECT_WITH_TRAINER + " ORDER BY c.id DESC")
            .stream().map(ClientDaoImpl::withoutSecrets).toList();
    }

    @Override
    public Optional<Map<String, Object>> findByIdWithTrainer(Long id) {
        return jdbc.queryForList(SELECT_WITH_TRAINER + " WHERE c.id = ?", id)
            .stream().findFirst().map(ClientDaoImpl::withoutSecrets);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM clients WHERE id = ?", id)
            .stream().findFirst().map(ClientDaoImpl::withoutSecrets);
    }

    @Override
    public Optional<Map<String, Object>> findByMemberCode(String code) {
        return jdbc.queryForList("SELECT name FROM clients WHERE member_code = ?", code).stream().findFirst();
    }

    @Override
    public Long nextMemberCode() {
        // Lowest number somebody gave back, else the next in the sequence.
        //
        // Both tables are consulted on purpose: `clients` is the authority on
        // what is taken right now, `member_codes` remembers what has ever been
        // issued. A number freed by a deletion goes to the front of the queue;
        // once none are free the sequence carries on from its high-water mark,
        // never from "highest free + 1", so a gap in the middle cannot make
        // the next member collide with somebody further up.
        return jdbc.queryForObject("""
            WITH taken AS (
                SELECT member_code::int AS code FROM clients WHERE member_code ~ '^[0-9]+$'
            ),
            freed AS (
                SELECT code FROM member_codes
                WHERE released_at IS NOT NULL AND code NOT IN (SELECT code FROM taken)
            ),
            issued AS (
                SELECT code FROM taken UNION SELECT code FROM member_codes
            )
            SELECT COALESCE(
                (SELECT MIN(code) FROM freed),
                (SELECT COALESCE(MAX(code), 0) + 1 FROM issued))""", Long.class);
    }

    @Override
    public void claimMemberCode(String code, Long memberId) {
        if (code == null || !code.matches("\\d+")) return;
        jdbc.update("""
            INSERT INTO member_codes (code, member_id, released_at)
            VALUES (?::int, ?, NULL)
            ON CONFLICT (code) DO UPDATE SET member_id = EXCLUDED.member_id, released_at = NULL""",
            code, memberId);
    }

    @Override
    public void releaseMemberCode(String code) {
        if (code == null || !code.matches("\\d+")) return;
        jdbc.update("""
            INSERT INTO member_codes (code, released_at) VALUES (?::int, NOW())
            ON CONFLICT (code) DO UPDATE SET released_at = NOW(), member_id = NULL""", code);
    }

    @Override
    public Optional<String> assignReferralCode(Long memberId, String referralCode) {
        if (memberId == null || referralCode == null || referralCode.isBlank()) {
            return Optional.empty();
        }
        // WHERE NOT EXISTS rather than catching the unique violation: a member
        // whose code happens to collide should still be created, just without
        // a code, instead of the whole signup failing at the desk.
        int rows = jdbc.update("""
            UPDATE clients SET referral_code = ?
            WHERE id = ?
              AND NOT EXISTS (SELECT 1 FROM clients WHERE referral_code = ? AND id <> ?)""",
            referralCode, memberId, referralCode, memberId);
        return rows > 0 ? Optional.of(referralCode) : Optional.empty();
    }

    @Override
    public Optional<Map<String, Object>> findByMemberCodeFull(String code) {
        return jdbc.queryForList(
            "SELECT id, member_code, name, phone, status, email, membership_expiry,"
                + " password_hash, password_set_at, must_reset_password"
                + " FROM clients WHERE member_code = ?", code)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByMemberCodeExcept(String code, Long exceptId) {
        return jdbc.queryForList("SELECT name FROM clients WHERE member_code = ? AND id <> ?", code, exceptId)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByCardUid(String uid) {
        return jdbc.queryForList("SELECT name FROM clients WHERE card_uid = ?", uid).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByCardUidExcept(String uid, Long exceptId) {
        return jdbc.queryForList("SELECT name FROM clients WHERE card_uid = ? AND id <> ?", uid, exceptId)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String code, String name, String phone, String email, String address,
                                      String gender, String dob, String join, String type, String start,
                                      String expiry, BigDecimal fee, BigDecimal paid, BigDecimal due,
                                      String paymentMode, String status, Long trainerId, String cardUid,
                                      String fingerprintStatus) {
        return jdbc.queryForMap(INSERT, code, name, phone, email, address, gender, dob, join, type,
            start, expiry, fee, paid, due, paymentMode, status, trainerId, cardUid, fingerprintStatus);
    }

    @Override
    public Map<String, Object> update(Long id, String name, String phone, String email, String address,
                                      String gender, String dob, String joinDate, String membershipType,
                                      String membershipStart, String membershipExpiry, BigDecimal fee,
                                      BigDecimal paid, String paymentMode, String status, Long trainerId,
                                      String memberCode, Boolean autoRenew, String recurringMethod,
                                      BigDecimal due, Boolean cardUidSet, String cardUidValue,
                                      Boolean fpSet, String fpValue) {
        return jdbc.queryForMap(UPDATE, name, phone, email, address, gender, dob, joinDate, membershipType,
            membershipStart, membershipExpiry, fee, paid, due, paymentMode, status, trainerId, memberCode,
            autoRenew, recurringMethod, recurringMethod, cardUidSet, cardUidValue, fpSet, fpValue, id);
    }

    @Override
    public int updateMemberCode(Long id, String newCode) {
        return jdbc.update("UPDATE clients SET member_code = ? WHERE id = ?", newCode, id);
    }

    @Override
    public int deactivate(Long id) {
        return jdbc.update("UPDATE clients SET status = 'inactive' WHERE id = ?", id);
    }

    /** Every table that holds a bare member_id with no cascade behind it. */
    private static final List<String> CHILD_TABLES = List.of(
        "payments", "member_progress", "workout_plans", "diet_plans", "class_bookings",
        "member_feedback", "assessments", "challenge_participants", "billing_attempts",
        "membership_events", "pt_sessions", "pt_subscriptions", "commissions", "referrals",
        "product_sales", "notification_log");

    @Override
    public Map<String, Integer> purge(Long id, String memberCode) {
        Map<String, Integer> removed = new LinkedHashMap<>();
        // Sessions hang off subscriptions, not the member, so they go first.
        removed.put("pt_sessions", jdbc.update("""
            DELETE FROM pt_sessions WHERE subscription_id IN
                (SELECT id FROM pt_subscriptions WHERE member_id = ?)""", id));
        for (String table : CHILD_TABLES) {
            if ("pt_sessions".equals(table)) continue;
            String column = "referrals".equals(table) ? "referrer_id" : "member_id";
            int n = jdbc.update("DELETE FROM " + table + " WHERE " + column + " = ?", id);
            removed.merge(table, n, Integer::sum);
        }
        // Attendance is keyed by the printed member code, not the row id.
        removed.put("attendance",
            jdbc.update("DELETE FROM attendance WHERE member_id::text = ?", memberCode));
        // A locker goes back on the wall; an invoice is a numbered document
        // that has to survive, so it keeps its number and loses the link.
        jdbc.update("""
            UPDATE lockers SET member_id = NULL, status = 'free', assigned_from = NULL,
                   assigned_until = NULL WHERE member_id = ?""", id);
        jdbc.update("UPDATE invoices SET member_id = NULL WHERE member_id = ?", id);
        jdbc.update("UPDATE clients SET referred_by_id = NULL WHERE referred_by_id = ?", id);
        jdbc.update("UPDATE leads SET converted_member_id = NULL WHERE converted_member_id = ?", id);

        removed.put("clients", jdbc.update("DELETE FROM clients WHERE id = ?", id));
        removed.values().removeIf(n -> n == 0);
        return removed;
    }

    @Override
    public Map<String, Object> freeze(Long id, String freezeUntil, String reason, String newExpiry) {
        return jdbc.queryForMap(FREEZE, freezeUntil, reason, newExpiry, id);
    }

    @Override
    public Map<String, Object> resume(Long id) {
        return jdbc.queryForMap(
            "UPDATE clients SET frozen_until = NULL, freeze_reason = NULL WHERE id = ? RETURNING *", id);
    }

    @Override
    public Map<String, Object> upgrade(Long id, String newType, String newExpiry) {
        return jdbc.queryForMap(
            "UPDATE clients SET membership_type = ?, membership_expiry = ? WHERE id = ? RETURNING *",
            newType, newExpiry, id);
    }

    @Override
    public Map<String, Object> cancelNow(Long id) {
        return jdbc.queryForMap(
            "UPDATE clients SET status = 'inactive', auto_renew = FALSE WHERE id = ? RETURNING *", id);
    }

    @Override
    public Map<String, Object> cancelAtExpiry(Long id) {
        return jdbc.queryForMap("UPDATE clients SET auto_renew = FALSE WHERE id = ? RETURNING *", id);
    }

    @Override
    public Map<String, Object> renew(Long id, String newExpiry, String type, BigDecimal fee, BigDecimal paid,
                                     String mode, BigDecimal renewDue) {
        return jdbc.queryForMap(RENEW, newExpiry, type, fee, paid, renewDue, mode, id);
    }

    @Override
    public int cascadeAttendanceCode(String oldCode, String newCode) {
        return jdbc.update("UPDATE attendance SET member_id = ? WHERE member_id = ?", newCode, oldCode);
    }

    @Override
    public List<Map<String, Object>> findEvents(Long memberId) {
        return jdbc.queryForList(
            "SELECT action, detail, created_at FROM membership_events WHERE member_id = ? ORDER BY id DESC LIMIT 50",
            memberId);
    }

    @Override
    public void logEvent(Long memberId, String action, String detail) {
        jdbc.update("INSERT INTO membership_events (member_id, action, detail) VALUES (?, ?, ?)",
            memberId, action, detail);
    }

    @Override
    public Optional<Map<String, Object>> findGateMemberByCode(String memberCode) {
        return jdbc.queryForList(GATE_SELECT + " WHERE member_code = ?", memberCode).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findGateMemberByCardUid(String cardUid) {
        return jdbc.queryForList(GATE_SELECT + " WHERE card_uid = ?", cardUid).stream().findFirst();
    }

    @Override
    public int updateFingerprintStatus(Long id, String status) {
        return jdbc.update("UPDATE clients SET fingerprint_status = ? WHERE id = ?", status, id);
    }

    private static final String GATE_SELECT = """
        SELECT id, member_code, name, status, membership_expiry, frozen_until, amount_due,
               fingerprint_status, card_uid
        FROM clients""";
}
