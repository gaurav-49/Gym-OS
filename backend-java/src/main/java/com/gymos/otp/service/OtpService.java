package com.gymos.otp.service;

import java.time.Instant;

/**
 * OTP lifecycle — generation, verification, per-user send rate limit and
 * failed-attempt lockout. Implemented by OtpServiceImpl.
 *
 * <p>Every call is scoped. Staff ids come from {@code users} and member ids
 * from {@code clients}; the two sequences overlap, so an unscoped OTP issued
 * to member 5 would unlock staff 5's account.
 */
public interface OtpService {

    /** Password resets for a staff account (users table). */
    String STAFF = "staff";

    /** Password resets for a member's portal account (clients table). */
    String MEMBER = "member";

    record OtpDelivery(String otp, String delivered) {
    }

    record FailureResult(boolean locked, int remaining, int lockedMinutes) {
    }

    int ttlMinutes();

    OtpDelivery createAndSendOtp(String scope, long userId, String contact, String method);

    boolean verifyOtp(String scope, long userId, String otp);

    /**
     * Check an OTP <em>without</em> spending it.
     *
     * <p>Splitting check from consume matters because the caller has more
     * validation to do after the OTP passes — the new password must also not be
     * one the account has used before. Consuming first meant a rejected
     * password burned the OTP and sent the user back for another one, which is
     * exactly what happens when someone forced to reset tries their old
     * password first.
     *
     * @return the reset row id to pass to {@link #consumeOtp(Long)}, or empty
     */
    java.util.Optional<Long> checkOtp(String scope, long userId, String otp);

    /** Spend an OTP previously returned by {@link #checkOtp}. */
    void consumeOtp(Long resetId);

    /**
     * Whether another OTP may be sent right now, and how long the wait is.
     *
     * @param allowed        send it
     * @param waitSeconds    seconds until the next send is permitted (0 when allowed)
     * @param sendsSoFar     sends already made inside the ladder's window
     * @param cooldownSeconds the wait that will apply after the next send
     */
    record ResendState(boolean allowed, long waitSeconds, int sendsSoFar, long cooldownSeconds) { }

    /**
     * The resend ladder. Each send costs progressively more waiting, so a
     * forgetful user is barely inconvenienced while someone hammering the
     * endpoint — to spam a member's inbox, or to grind OTPs — is stopped
     * without ever locking the account.
     */
    ResendState resendState(String scope, long userId);

    /** @deprecated use {@link #resendState(String, long)}; kept so callers read naturally. */
    boolean canSendOtp(String scope, long userId);

    /** Forget this user's send history once a reset has actually succeeded. */
    void clearSendHistory(String scope, long userId);

    /** @return the lockout time if the user is currently locked out, else null */
    Instant getLockUntil(String scope, long userId);

    FailureResult registerFailure(String scope, long userId);

    void clearFailures(String scope, long userId);
}
