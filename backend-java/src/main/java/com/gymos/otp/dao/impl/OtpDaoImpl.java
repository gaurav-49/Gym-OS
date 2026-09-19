package com.gymos.otp.dao.impl;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.otp.dao.OtpDao;

/**
 * OTP DAO implementation — the SQL for the otp module (password_resets +
 * otp_attempts tables) lives here, mirroring the Node otpService queries.
 *
 * <p>Every predicate carries the scope alongside the user id; see
 * {@link OtpDao} for why the id alone is not a key.
 */
@Repository
public class OtpDaoImpl implements OtpDao {

    private final JdbcTemplate jdbc;

    public OtpDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String INSERT_RESET = """
        INSERT INTO password_resets (scope, user_id, otp_hash, method, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """;
    private static final String SELECT_VALID_RESET = """
        SELECT id FROM password_resets
        WHERE scope = ? AND user_id = ? AND otp_hash = ? AND used = FALSE AND expires_at > NOW()
        ORDER BY id DESC LIMIT 1
        """;
    private static final String MARK_USED = "UPDATE password_resets SET used = TRUE WHERE id = ?";
    private static final String COUNT_LAST_HOUR = """
        SELECT COUNT(*) FROM password_resets
        WHERE scope = ? AND user_id = ? AND created_at > NOW() - INTERVAL '1 hour'
        """;
    private static final String SELECT_ACTIVE_LOCK =
        "SELECT locked_until FROM otp_attempts WHERE scope = ? AND user_id = ?";
    private static final String INCREMENT_FAILURES = """
        INSERT INTO otp_attempts (scope, user_id, failed_count) VALUES (?, ?, 1)
        ON CONFLICT (scope, user_id) DO UPDATE SET
            failed_count = otp_attempts.failed_count + 1, last_attempt_at = NOW()
        RETURNING failed_count
        """;
    private static final String APPLY_LOCK = """
        UPDATE otp_attempts
        SET locked_until = NOW() + (? || ' minutes')::interval, failed_count = 0
        WHERE scope = ? AND user_id = ?
        """;
    private static final String CLEAR_FAILURES = "DELETE FROM otp_attempts WHERE scope = ? AND user_id = ?";

    @Override
    public void insertReset(String scope, Long userId, String otpHash, String method, Instant expiresAt) {
        // The pg driver cannot infer a SQL type from an Instant — convert to
        // Timestamp at the DAO boundary (matches the reverse mapping in findActiveLock).
        jdbc.update(INSERT_RESET, scope, userId, otpHash, method, Timestamp.from(expiresAt));
    }

    @Override
    public Optional<Long> findValidResetId(String scope, Long userId, String otpHash) {
        return jdbc.query(SELECT_VALID_RESET, (rs, i) -> rs.getLong("id"), scope, userId, otpHash)
            .stream().findFirst();
    }

    @Override
    public void markUsed(Long resetId) {
        jdbc.update(MARK_USED, resetId);
    }

    @Override
    public int countSendsInLastHour(String scope, Long userId) {
        Integer n = jdbc.queryForObject(COUNT_LAST_HOUR, Integer.class, scope, userId);
        return n == null ? 0 : n;
    }

    @Override
    public int countSendsInLastHours(String scope, Long userId, int hours) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*) FROM password_resets"
                + " WHERE scope = ? AND user_id = ? AND created_at > NOW() - (? || ' hours')::interval",
            Integer.class, scope, userId, String.valueOf(hours));
        return n == null ? 0 : n;
    }

    @Override
    public Optional<Instant> lastSentAt(String scope, Long userId) {
        return jdbc.query("SELECT MAX(created_at) AS t FROM password_resets WHERE scope = ? AND user_id = ?",
                (rs, i) -> {
                    var ts = rs.getTimestamp("t");
                    return ts == null ? null : ts.toInstant();
                }, scope, userId).stream()
            .filter(java.util.Objects::nonNull)
            .findFirst();
    }

    @Override
    public void clearSendHistory(String scope, Long userId) {
        jdbc.update("DELETE FROM password_resets WHERE scope = ? AND user_id = ?", scope, userId);
    }

    @Override
    public Optional<Instant> findActiveLock(String scope, Long userId) {
        return jdbc.query(SELECT_ACTIVE_LOCK, (rs, i) -> {
                var ts = rs.getTimestamp("locked_until");
                return ts == null ? null : ts.toInstant();
            }, scope, userId).stream()
            // Stream.findFirst() throws NPE on a null element (JDK FindOps uses
            // Optional.of), and a row with locked_until IS NULL is a normal state
            // after failed attempts — drop nulls before looking for an active lock.
            .filter(java.util.Objects::nonNull)
            .findFirst()
            .filter(lock -> lock.isAfter(Instant.now()));
    }

    @Override
    public int incrementFailures(String scope, Long userId) {
        Integer n = jdbc.queryForObject(INCREMENT_FAILURES, Integer.class, scope, userId);
        return n == null ? 0 : n;
    }

    @Override
    public void applyLock(String scope, Long userId, int lockoutMinutes) {
        jdbc.update(APPLY_LOCK, lockoutMinutes, scope, userId);
    }

    @Override
    public void clearFailures(String scope, Long userId) {
        jdbc.update(CLEAR_FAILURES, scope, userId);
    }
}
