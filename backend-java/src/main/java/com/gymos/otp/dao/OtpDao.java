package com.gymos.otp.dao;

import java.time.Instant;
import java.util.Optional;

/**
 * OTP / password-reset data access. All SQL for this module lives in
 * {@link com.gymos.otp.dao.impl.OtpDaoImpl}.
 *
 * <p>Every method is keyed on <em>(scope, userId)</em>, never on the id alone.
 * Staff live in {@code users} and members in {@code clients}, two tables whose
 * ids overlap freely — without the scope, member 5's OTP would satisfy staff
 * 5's password reset.
 */
public interface OtpDao {

    void insertReset(String scope, Long userId, String otpHash, String method, Instant expiresAt);

    /** @return the id of the newest unused, unexpired reset row for the hash, if any */
    Optional<Long> findValidResetId(String scope, Long userId, String otpHash);

    /** Spend a reset row. The row id is unique on its own, so no scope is needed. */
    void markUsed(Long resetId);

    /** @return OTP sends for the user in the last hour (rate limit input) */
    int countSendsInLastHour(String scope, Long userId);

    /** @return OTP sends in the last {@code hours} hours — the resend ladder's rung. */
    int countSendsInLastHours(String scope, Long userId, int hours);

    /** @return when the most recent OTP was sent, if there is one. */
    Optional<Instant> lastSentAt(String scope, Long userId);

    /** Forget this user's send history — called once a reset actually succeeds. */
    void clearSendHistory(String scope, Long userId);

    /** @return current lockout deadline if the user is locked out, else empty */
    Optional<Instant> findActiveLock(String scope, Long userId);

    /** @return the new failed_count after this failure (INSERT … ON CONFLICT UPDATE) */
    int incrementFailures(String scope, Long userId);

    void applyLock(String scope, Long userId, int lockoutMinutes);

    void clearFailures(String scope, Long userId);
}
