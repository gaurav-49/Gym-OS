package com.gymos.common.security;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Failed-login accounting for the three login doors: staff
 * (/api/auth/login), the member portal (/api/member/login) and class booking
 * (/api/member/classes/verify).
 *
 * <p><b>There is no timed lockout.</b> An account that burns its allowance is
 * not made to wait — waiting helps nobody. Instead:
 *
 * <ul>
 *   <li><b>Staff accounts</b> are flagged {@code must_reset_password}. That is
 *       strictly stronger than a fifteen-minute wait: no password opens the
 *       account until a new one is set, so continuing to guess is pointless,
 *       and the legitimate owner has an immediate way back in rather than a
 *       timer. See {@code AuthServiceImpl}.</li>
 *   <li><b>Members</b> have no password to reset, so the only lever left is
 *       cost. Once the allowance is spent, each further attempt is answered
 *       slowly ({@link #penaltyDelayMillis}). A real member who mistypes a few
 *       times never reaches it; a script trying thousands of phone numbers
 *       does, and drops from thousands of guesses a minute to a handful.</li>
 * </ul>
 *
 * <p>Counting continues in both cases — the row in {@code login_attempts} is
 * what makes an attack visible to whoever looks.
 */
@Service
public class LoginThrottleService {

    /** One counter to check, increment and clear. */
    public record Key(String scope, String identifier) { }

    /**
     * Outcome of registering a failure.
     *
     * @param exhausted the allowance for this account is spent
     * @param remaining attempts left before that happens
     */
    public record Failure(boolean exhausted, int remaining) { }

    private final JdbcTemplate jdbc;
    private final int maxFailedAttempts;
    private final int maxFailedPerIp;
    private final int decayMinutes;
    private final long penaltyDelayMillis;

    public LoginThrottleService(JdbcTemplate jdbc,
                                @Value("${app.login.max-failed-attempts:5}") int maxFailedAttempts,
                                @Value("${app.login.max-failed-per-ip:20}") int maxFailedPerIp,
                                @Value("${app.login.penalty-delay-ms:1500}") long penaltyDelayMillis,
                                @Value("${app.login.decay-minutes:15}") int decayMinutes) {
        this.jdbc = jdbc;
        this.maxFailedAttempts = maxFailedAttempts;
        this.maxFailedPerIp = maxFailedPerIp;
        this.penaltyDelayMillis = penaltyDelayMillis;
        this.decayMinutes = decayMinutes;
    }

    public int maxFailedAttempts() {
        return maxFailedAttempts;
    }

    public long penaltyDelayMillis() {
        return penaltyDelayMillis;
    }

    private int limitFor(String scope) {
        return "ip".equals(scope) ? maxFailedPerIp : maxFailedAttempts;
    }

    /** Trim and cap so an oversized body field cannot exceed the column width. */
    private static String normalize(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim().toLowerCase();
        return trimmed.length() > 160 ? trimmed.substring(0, 160) : trimmed;
    }

    /**
     * The keys one attempt counts against: the account itself plus the caller's IP.
     *
     * @param scope   {@code staff}, {@code member} or {@code booking}
     * @param account username or member code — it need not exist
     * @param request the servlet request, for the source address
     */
    public List<Key> keysFor(String scope, String account, HttpServletRequest request) {
        List<Key> keys = new ArrayList<>();
        String id = normalize(account);
        if (!id.isEmpty()) {
            keys.add(new Key(scope, id));
        }
        String ip = normalize(clientIp(request));
        if (!ip.isEmpty()) {
            keys.add(new Key("ip", scope + ":" + ip));
        }
        return keys;
    }

    // Honour X-Forwarded-For so a reverse proxy does not collapse every gym
    // into one IP counter. Only the left-most (original client) hop is used.
    private static String clientIp(HttpServletRequest request) {
        if (request == null) {
            return "";
        }
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr() == null ? "" : request.getRemoteAddr();
    }

    /**
     * Record one failed login against every key.
     *
     * @return the account-key state — {@code remaining} is what the user is told
     */
    public Failure registerFailure(List<Key> keys) {
        Failure account = new Failure(false, maxFailedAttempts);
        for (Key key : keys) {
            // A gap longer than decayMinutes restarts the count, so an honest
            // user who fumbled a password this morning is not one typo from
            // having their password forcibly reset.
            Integer count = jdbc.queryForObject("""
                INSERT INTO login_attempts (scope, identifier, failed_count)
                VALUES (?, ?, 1)
                ON CONFLICT (scope, identifier) DO UPDATE SET
                    failed_count = CASE
                        WHEN login_attempts.last_attempt_at < NOW() - (? || ' minutes')::interval THEN 1
                        ELSE login_attempts.failed_count + 1
                    END,
                    last_attempt_at = NOW()
                RETURNING failed_count""",
                Integer.class, key.scope(), key.identifier(), String.valueOf(decayMinutes));
            int failures = count == null ? 0 : count;
            boolean spent = failures >= limitFor(key.scope());
            if (!"ip".equals(key.scope())) {
                account = new Failure(spent, Math.max(0, limitFor(key.scope()) - failures));
            } else if (spent) {
                // The address tripped even though this account had not.
                account = new Failure(true, 0);
            }
        }
        return account;
    }

    /**
     * How many failures are already recorded against the account key — used to
     * decide whether an attempt has earned the slow reply.
     */
    public int failureCount(List<Key> keys) {
        if (keys.isEmpty()) {
            return 0;
        }
        StringBuilder in = new StringBuilder();
        List<Object> params = new ArrayList<>();
        for (Key key : keys) {
            in.append(in.isEmpty() ? "" : ", ").append("(?, ?)");
            params.add(key.scope());
            params.add(key.identifier());
        }
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT COALESCE(MAX(failed_count), 0) AS n FROM login_attempts"
                + " WHERE (scope, identifier) IN (" + in + ")"
                + " AND last_attempt_at > NOW() - (? || ' minutes')::interval",
            append(params, String.valueOf(decayMinutes)));
        Object n = rows.isEmpty() ? null : rows.get(0).get("n");
        return n == null ? 0 : ((Number) n).intValue();
    }

    private static Object[] append(List<Object> params, Object extra) {
        List<Object> all = new ArrayList<>(params);
        all.add(extra);
        return all.toArray();
    }

    /**
     * Answer slowly once the allowance is spent. Not a lockout: the attempt is
     * still processed and a correct credential still succeeds — it just stops
     * being cheap to keep guessing. Interruption is honoured so a shutdown is
     * never held up by a penalty.
     */
    public void applyPenaltyDelay(List<Key> keys) {
        if (penaltyDelayMillis <= 0 || failureCount(keys) < maxFailedAttempts) {
            return;
        }
        try {
            Thread.sleep(penaltyDelayMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Clear every counter after a successful login. */
    public void clearFailures(List<Key> keys) {
        if (keys.isEmpty()) {
            return;
        }
        StringBuilder in = new StringBuilder();
        List<Object> params = new ArrayList<>();
        for (Key key : keys) {
            in.append(in.isEmpty() ? "" : ", ").append("(?, ?)");
            params.add(key.scope());
            params.add(key.identifier());
        }
        jdbc.update("DELETE FROM login_attempts WHERE (scope, identifier) IN (" + in + ")",
            params.toArray());
    }

    /** Housekeeping: drop rows that have not been touched for a day. */
    public int purgeStale() {
        return jdbc.update("""
            DELETE FROM login_attempts
            WHERE last_attempt_at < NOW() - INTERVAL '24 hours'""");
    }
}
