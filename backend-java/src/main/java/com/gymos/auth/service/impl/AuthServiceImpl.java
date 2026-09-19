package com.gymos.auth.service.impl;

import java.time.Instant;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.gymos.auth.dao.UserDao;
import com.gymos.auth.dto.ForgotResponse;
import com.gymos.auth.dto.LoginResponse;
import com.gymos.auth.dto.RecoveryOptionsResponse;
import com.gymos.auth.entity.User;
import com.gymos.auth.service.AuthService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.security.AuthUser;
import com.gymos.common.security.JwtService;
import com.gymos.common.security.LoginThrottleService;
import com.gymos.common.security.PasswordPolicy;
import com.gymos.common.security.Usernames;
import com.gymos.common.util.Durations;
import com.gymos.common.util.MaskingUtils;
import com.gymos.otp.service.OtpService;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Auth service — the exact same validations, messages and status codes as the
 * Node authController.js so the React frontend behaves identically.
 */
@Service
public class AuthServiceImpl implements AuthService {

    // Deliberate product decision: the reply distinguishes an unknown username
    // from a wrong password, because staff at a busy front desk cannot tell
    // which half they got wrong from a combined message.
    //
    // The cost is username enumeration — anyone can probe /api/auth/login to
    // learn which accounts exist. What keeps that expensive is that the
    // throttle counts failures against usernames that do NOT exist too, on the
    // same five-strike budget, so a probe run locks itself out after five
    // guesses and twenty from one address. Enumeration is slow and leaves a
    // trail in login_attempts rather than being free and silent.
    private static final String NO_SUCH_USER =
        "No account found with that username. Please check the spelling and try again.";
    private static final String WRONG_PASSWORD = "Incorrect password.";

    // A real BCrypt hash of a throwaway string, compared against when the
    // username does not exist. The message no longer hides which case it was,
    // but an unauthenticated caller should still not be able to measure it.
    private static final String DUMMY_HASH = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    /** Sent to the frontend so it can open the reset dialog instead of guessing. */
    public static final String PASSWORD_RESET_REQUIRED = "PASSWORD_RESET_REQUIRED";

    private final UserDao userDao;
    private final OtpService otpService;
    private final JwtService jwtService;
    private final PasswordEncoder passwordEncoder;
    private final LoginThrottleService loginThrottle;
    private final PasswordPolicy passwordPolicy;
    // Request-scoped proxy: Spring resolves the current request per call, so the
    // per-IP counter sees the real caller even though this service is a singleton.
    private final HttpServletRequest request;

    public AuthServiceImpl(UserDao userDao, OtpService otpService,
                           JwtService jwtService, PasswordEncoder passwordEncoder,
                           LoginThrottleService loginThrottle, PasswordPolicy passwordPolicy,
                           HttpServletRequest request) {
        this.userDao = userDao;
        this.otpService = otpService;
        this.jwtService = jwtService;
        this.passwordEncoder = passwordEncoder;
        this.loginThrottle = loginThrottle;
        this.passwordPolicy = passwordPolicy;
        this.request = request;
    }

    /**
     * Throttled login. Five failures on one username (or twenty from one IP)
     * spend the allowance: a real account is then flagged to require a new
     * password, and an address guessing at usernames that do not exist simply
     * gets slow replies. Nothing is locked on a timer — see the note above on
     * why the two failure cases are told apart.
     */
    @Override
    public LoginResponse login(String username, String password) {
        if (username == null || password == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Username and password are required");
        }
        // Normalised before the throttle key, not just before the lookup:
        // counting "admin" and "Admin" separately would have handed a guesser
        // a fresh five-attempt allowance for every capitalisation of one name.
        String canonical = Usernames.normalise(username);
        List<LoginThrottleService.Key> keys = loginThrottle.keysFor("staff", canonical, request);

        User user = userDao.findByUsername(canonical).orElse(null);
        // Always run a compare so an unknown username costs the same as a wrong password.
        boolean ok = passwordEncoder.matches(password, user == null ? DUMMY_HASH : user.passwordHash());

        if (user == null || !ok) {
            LoginThrottleService.Failure attempt = loginThrottle.registerFailure(keys);

            if (attempt.exhausted() && user != null) {
                // The allowance is spent. For a real account that means the
                // password is either forgotten or being guessed at, and both
                // are answered by replacing it. No waiting period: a timer
                // would only delay the legitimate owner, while the reset flag
                // already makes further guessing pointless — from here no
                // password opens the account until a new one is set.
                userDao.setMustResetPassword(user.id(), true);
                throw new BusinessException(HttpStatus.FORBIDDEN,
                    "Too many failed attempts. For security this account now needs a new password."
                        + " Use \"Forgot password?\" to set one — you can sign in again straight away. "
                        + PASSWORD_RESET_REQUIRED);
            }

            if (user == null) {
                // Nothing to flag on an account that does not exist, so the
                // only remaining cost is time: once the allowance is spent this
                // address gets a deliberately slow reply.
                loginThrottle.applyPenaltyDelay(keys);
                // No attempt count on this branch: it would tell a prober how
                // close the address is to being locked out. A real user who
                // mistyped their username just needs to know it was the username.
                throw new BusinessException(HttpStatus.UNAUTHORIZED, NO_SUCH_USER);
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                WRONG_PASSWORD + " " + attempt.remaining() + " attempt(s) left"
                    + (attempt.remaining() == 1 ? " before you will have to set a new password." : "."));
        }

        // Correct password, but the account was flagged after a run of failures
        // and must be changed before it is usable — otherwise the forced reset
        // would be advisory and the guessing could simply continue.
        if (user.mustResetPassword()) {
            throw new BusinessException(HttpStatus.FORBIDDEN,
                "Your password must be reset before you can sign in."
                    + " Use \"Forgot password?\" to set a new one. "
                    + PASSWORD_RESET_REQUIRED);
        }

        loginThrottle.clearFailures(keys);
        AuthUser authUser = new AuthUser(user.id(), user.username(), user.role(), user.name());
        return new LoginResponse(jwtService.sign(authUser), authUser);
    }

    @Override
    public RecoveryOptionsResponse recoveryOptions(String username) {
        User user = userDao.findByUsername(Usernames.normalise(username)).orElse(null);
        return new RecoveryOptionsResponse(
            user != null && user.email() != null ? MaskingUtils.maskEmail(user.email()) : null,
            user != null && user.phone() != null ? MaskingUtils.maskPhone(user.phone()) : null
        );
    }

    @Override
    public ForgotResponse forgot(String username, String method) {
        if (username == null || method == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Username and method are required");
        }
        if (!"email".equals(method) && !"sms".equals(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Method must be email or sms");
        }
        User user = userDao.findByUsername(Usernames.normalise(username)).orElse(null);
        String contact = user != null
            ? ("email".equals(method) ? user.email() : user.phone())
            : null;
        if (user == null || contact == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "No " + method + " on file for this account. Contact your gym admin.");
        }
        // The resend ladder: each OTP costs a longer wait than the last, so
        // asking twice is nearly free and asking twenty times is not.
        OtpService.ResendState resend = otpService.resendState(OtpService.STAFF, user.id());
        if (!resend.allowed()) {
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                "Please wait " + Durations.describe(resend.waitSeconds()) + " before requesting another OTP.");
        }
        OtpService.OtpDelivery delivery;
        try {
            delivery = otpService.createAndSendOtp(OtpService.STAFF, user.id(), contact, method);
        } catch (Exception e) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to send OTP. Check the gateway configuration.", e);
        }
        // Report the wait that now applies, so the dialog can start counting
        // down the moment the OTP goes out.
        long nextWait = otpService.resendState(OtpService.STAFF, user.id()).waitSeconds();
        return new ForgotResponse(
            "OTP sent to your " + ("email".equals(method) ? "email" : "phone") + ".",
            method,
            "email".equals(method) ? MaskingUtils.maskEmail(contact) : MaskingUtils.maskPhone(contact),
            otpService.ttlMinutes(),
            nextWait,
            "console".equals(delivery.delivered()) ? delivery.otp() : null
        );
    }

    @Override
    public void verifyOtpReset(String username, String otp, String newPassword) {
        if (username == null || otp == null || newPassword == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Username, OTP and new password are required");
        }
        // Shape first — a too-short password should not cost a database lookup,
        // and must not reach the OTP at all.
        passwordPolicy.validateFormat(newPassword);
        // Same reply as a bad OTP — a 404 here would confirm which usernames exist.
        User user = userDao.findByUsername(Usernames.normalise(username)).orElseThrow(() ->
            new BusinessException(HttpStatus.UNAUTHORIZED, "Invalid or expired OTP."));

        Instant lockedUntil = otpService.getLockUntil(OtpService.STAFF, user.id());
        if (lockedUntil != null) {
            long remainingMs = lockedUntil.toEpochMilli() - System.currentTimeMillis();
            long mins = Math.max(1, (remainingMs + 59999) / 60000);
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                "Too many failed attempts. Try again in " + mins + " minute(s).");
        }

        // Check the OTP without spending it yet.
        Long resetId = otpService.checkOtp(OtpService.STAFF, user.id(), otp).orElse(null);
        if (resetId == null) {
            OtpService.FailureResult attempt = otpService.registerFailure(OtpService.STAFF, user.id());
            if (attempt.locked()) {
                throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many failed attempts. OTP verification is locked for "
                        + attempt.lockedMinutes() + " minutes.");
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                "Invalid or expired OTP. " + attempt.remaining() + " attempt(s) left.");
        }

        // The OTP is genuine — but the new password still has to be one the
        // account has not used before, or a forced reset is satisfied by
        // re-entering the very password that was just being guessed at.
        //
        // This runs before the OTP is spent, so being told "pick a different
        // password" costs the user a retype rather than a whole new OTP. It is
        // also behind a valid OTP, so it cannot be used to probe whether some
        // password was ever used on an account.
        String hash = passwordPolicy.hashForChange(user.id(), newPassword);

        otpService.consumeOtp(resetId);
        otpService.clearFailures(OtpService.STAFF, user.id());
        // The reset worked, so the escalating resend cost has done its job —
        // start the ladder fresh rather than leaving the account on a long
        // cooldown for the next genuine reset.
        otpService.clearSendHistory(OtpService.STAFF, user.id());
        userDao.changePassword(user.id(), hash);
        // A reset is the intended way out, so clear the login counters too —
        // otherwise the user sets a new password and the very next mistype
        // lands them straight back on a spent allowance.
        loginThrottle.clearFailures(loginThrottle.keysFor("staff", user.username(), request));
    }
}
