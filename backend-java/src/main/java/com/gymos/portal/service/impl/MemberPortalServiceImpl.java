package com.gymos.portal.service.impl;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.security.AuthUser;
import com.gymos.common.security.JwtService;
import com.gymos.common.security.LoginThrottleService;
import com.gymos.common.util.Dates;
import com.gymos.common.util.Durations;
import com.gymos.common.util.MaskingUtils;
import com.gymos.member.dao.ClientDao;
import com.gymos.otp.service.OtpService;
import com.gymos.portal.dao.MemberPortalDao;
import com.gymos.portal.service.MemberPortalService;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Member portal service — the QR payload prefix matches the desk scanner
 * contract (GYMOS:<member_code>), so a random QR can't punch anyone.
 */
@Service
public class MemberPortalServiceImpl implements MemberPortalService {

    private static final String QR_PREFIX = "GYMOS";
    private static final int MIN_PASSWORD = 6;

    /** Costs the same as a real comparison when the Member ID does not exist. */
    private static final String DUMMY_HASH =
        "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private static final long MEMBER_TOKEN_TTL = 12L * 60 * 60 * 1000;
    private static final String MEMBER_TOKEN_EXPIRY = "12h";

    private final MemberPortalDao portalDao;
    private final ClientDao clientDao;
    private final JwtService jwtService;
    private final LoginThrottleService loginThrottle;
    private final PasswordEncoder passwordEncoder;
    private final OtpService otpService;
    private final HttpServletRequest request;

    /**
     * The password every member starts on. Configurable per install because a
     * gym that would rather not run an open default can set its own; the
     * shipped value is what the desk tells a new member.
     */
    private final String defaultPassword;

    /**
     * Hashed once at startup so that a member row whose password_hash somehow
     * never got the column default still authenticates on the gym default,
     * instead of being locked out of a portal nobody knows how to reset.
     */
    private final String defaultPasswordHash;

    public MemberPortalServiceImpl(MemberPortalDao portalDao, ClientDao clientDao, JwtService jwtService,
                                   LoginThrottleService loginThrottle, PasswordEncoder passwordEncoder,
                                   OtpService otpService, HttpServletRequest request,
                                   @Value("${app.member.default-password:admin}") String defaultPassword) {
        this.portalDao = portalDao;
        this.clientDao = clientDao;
        this.jwtService = jwtService;
        this.loginThrottle = loginThrottle;
        this.passwordEncoder = passwordEncoder;
        this.otpService = otpService;
        this.request = request;
        this.defaultPassword = defaultPassword;
        this.defaultPasswordHash = passwordEncoder.encode(defaultPassword);
    }

    /**
     * Refuse a sign-in once the membership has run out.
     *
     * <p>Deliberately after the password check: answering "expired on the 5th"
     * to anyone who types a Member ID would tell a stranger both that the ID
     * is real and when its owner last paid.
     */
    private void requireLiveMembership(Map<String, Object> member) {
        String expiry = str(member, "membership_expiry");
        if (expiry == null || expiry.isBlank()) {
            return;
        }
        if (expiry.compareTo(Dates.todayStr()) >= 0) {
            return;
        }
        throw new BusinessException(HttpStatus.FORBIDDEN,
            "Your membership expired on " + Dates.friendly(expiry)
                + ". Please renew at the front desk to use the member portal.");
    }

    /** The hash to compare against: the member's own, or the gym default. */
    private String hashFor(Map<String, Object> member) {
        String hash = member == null ? null : (String) member.get("password_hash");
        if (hash != null && !hash.isBlank()) {
            return hash;
        }
        return defaultPasswordHash == null ? DUMMY_HASH : defaultPasswordHash;
    }

    /**
     * True while the member has never chosen a password of their own.
     * password_set_at is written only by a real change, so its absence — not
     * the hash — is what "still on the gym default" means.
     */
    private static boolean onDefaultPassword(Map<String, Object> member) {
        return member != null && member.get("password_set_at") == null;
    }

    @Override
    public Map<String, Object> login(String memberCode, String password) {
        if (memberCode == null || memberCode.isEmpty() || password == null || password.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Member ID and password are required");
        }
        List<LoginThrottleService.Key> keys = loginThrottle.keysFor("member", memberCode, request);

        Map<String, Object> member = clientDao.findByMemberCodeFull(memberCode.trim()).orElse(null);

        // Always compare, so an unknown Member ID costs the same as a wrong password.
        boolean ok = passwordEncoder.matches(password, member == null ? DUMMY_HASH : hashFor(member));
        if (member == null || !ok) {
            LoginThrottleService.Failure attempt = loginThrottle.registerFailure(keys);
            // No lockout — a member locked out of their own portal at the gym
            // door has no way back in. Once the allowance is spent the reply
            // simply comes back slowly, so a real member barely notices while
            // a script grinding through passwords is stopped dead.
            if (attempt.exhausted()) {
                loginThrottle.applyPenaltyDelay(keys);
            }
            if (member == null) {
                throw new BusinessException(HttpStatus.UNAUTHORIZED,
                    "No member found with ID " + memberCode.trim()
                        + ". Check the Member ID and try again.");
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                "Incorrect password. " + attempt.remaining() + " attempt(s) left"
                    + (attempt.remaining() == 1 ? " before this slows down." : "."));
        }
        if (Boolean.TRUE.equals(member.get("must_reset_password"))) {
            throw new BusinessException(HttpStatus.FORBIDDEN,
                "Your password must be reset before you can sign in. Use \"Forgot password?\".");
        }
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.FORBIDDEN,
                "This member account is inactive. Please contact the gym.");
        }
        // An expired membership is not a portal account. Letting it in showed
        // someone their plan, their dues and a QR code that the desk would
        // then refuse — the renewal has to be the only thing in front of them.
        requireLiveMembership(member);

        loginThrottle.clearFailures(keys);
        return session(member, null);
    }

    /**
     * Change a password by proving the current one.
     *
     * <p>Public rather than behind the member JWT on purpose: the member who
     * most needs this is the one still on the shared default, standing at the
     * login screen. Knowing the current password is the proof, so requiring a
     * session first would only add a step.
     */
    @Override
    public Map<String, Object> changePassword(String memberCode, String currentPassword, String newPassword) {
        if (memberCode == null || memberCode.isBlank() || currentPassword == null || currentPassword.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Member ID and your current password are required.");
        }
        // Shape first: a too-short password should not cost a lookup, and the
        // member should hear about it before anything else can go wrong.
        validateNewPassword(newPassword);

        List<LoginThrottleService.Key> keys = loginThrottle.keysFor("member", memberCode, request);
        Map<String, Object> member = clientDao.findByMemberCodeFull(memberCode.trim()).orElse(null);
        boolean ok = passwordEncoder.matches(currentPassword, member == null ? DUMMY_HASH : hashFor(member));

        if (member == null || !ok) {
            LoginThrottleService.Failure attempt = loginThrottle.registerFailure(keys);
            if (attempt.exhausted()) {
                loginThrottle.applyPenaltyDelay(keys);
            }
            if (member == null) {
                throw new BusinessException(HttpStatus.UNAUTHORIZED,
                    "No member found with ID " + memberCode.trim()
                        + ". Check the Member ID and try again.");
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                "That is not your current password. " + attempt.remaining() + " attempt(s) left"
                    + (attempt.remaining() == 1 ? " before this slows down." : "."));
        }
        // Otherwise "change your password" is satisfied by retyping the one
        // everybody already knows.
        if (passwordEncoder.matches(newPassword, hashFor(member))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Your new password must be different from your current one.");
        }
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.FORBIDDEN,
                "This member account is inactive. Please contact the gym.");
        }

        Long memberId = toLong(member.get("id"));
        portalDao.setPassword(memberId, passwordEncoder.encode(newPassword));
        loginThrottle.clearFailures(keys);

        // The member is on their own password now, whatever the row said a
        // moment ago — say so in the session rather than re-reading the row.
        Map<String, Object> out = session(member, Boolean.FALSE);
        out.put("message", "Password changed. Use your Member ID and your new password from now on.");
        return out;
    }

    @Override
    public Map<String, Object> recoveryOptions(String memberCode) {
        Map<String, Object> member = memberCode == null || memberCode.isBlank()
            ? null
            : clientDao.findByMemberCodeFull(memberCode.trim()).orElse(null);
        String email = member == null ? null : str(member, "email");
        String phone = member == null ? null : str(member, "phone");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("email", email == null || email.isBlank() ? null : MaskingUtils.maskEmail(email));
        out.put("phone", phone == null || phone.isBlank() ? null : MaskingUtils.maskPhone(phone));
        return out;
    }

    @Override
    public Map<String, Object> forgot(String memberCode, String method) {
        if (memberCode == null || memberCode.isBlank() || method == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Member ID and method are required");
        }
        if (!"email".equals(method) && !"sms".equals(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Method must be email or sms");
        }
        Map<String, Object> member = clientDao.findByMemberCodeFull(memberCode.trim()).orElse(null);
        String contact = member == null ? null
            : ("email".equals(method) ? str(member, "email") : str(member, "phone"));
        if (member == null || contact == null || contact.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "No " + ("email".equals(method) ? "email" : "phone number")
                    + " on file for this Member ID. Ask the front desk to add one.");
        }
        Long memberId = toLong(member.get("id"));

        // The resend ladder: each OTP costs a longer wait than the last, so
        // asking twice is nearly free and asking twenty times is not.
        OtpService.ResendState resend = otpService.resendState(OtpService.MEMBER, memberId);
        if (!resend.allowed()) {
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                "Please wait " + Durations.describe(resend.waitSeconds()) + " before requesting another OTP.");
        }
        OtpService.OtpDelivery delivery;
        try {
            delivery = otpService.createAndSendOtp(OtpService.MEMBER, memberId, contact, method);
        } catch (Exception e) {
            throw new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR,
                "Failed to send OTP. Ask the front desk to reset your password instead.", e);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "OTP sent to your " + ("email".equals(method) ? "email" : "phone") + ".");
        out.put("method", method);
        out.put("sent_to", "email".equals(method)
            ? MaskingUtils.maskEmail(contact) : MaskingUtils.maskPhone(contact));
        out.put("ttl_minutes", otpService.ttlMinutes());
        // The wait that now applies, so the dialog starts counting down the
        // moment the OTP goes out rather than after the member asks again.
        out.put("resend_after_seconds", otpService.resendState(OtpService.MEMBER, memberId).waitSeconds());
        // Only ever populated by the console gateway used in development.
        out.put("dev_otp", "console".equals(delivery.delivered()) ? delivery.otp() : null);
        return out;
    }

    @Override
    public Map<String, Object> verifyOtpReset(String memberCode, String otp, String newPassword) {
        if (memberCode == null || memberCode.isBlank() || otp == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Member ID, OTP and new password are required");
        }
        validateNewPassword(newPassword);

        // Same reply as a bad OTP — a 404 here would turn the reset endpoint
        // into a free check of which Member IDs exist.
        Map<String, Object> member = clientDao.findByMemberCodeFull(memberCode.trim())
            .orElseThrow(() -> new BusinessException(HttpStatus.UNAUTHORIZED, "Invalid or expired OTP."));
        Long memberId = toLong(member.get("id"));

        Instant lockedUntil = otpService.getLockUntil(OtpService.MEMBER, memberId);
        if (lockedUntil != null) {
            long remainingMs = lockedUntil.toEpochMilli() - System.currentTimeMillis();
            long mins = Math.max(1, (remainingMs + 59999) / 60000);
            throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                "Too many failed attempts. Try again in " + mins + " minute(s).");
        }

        // Check the OTP without spending it yet — a new password rejected below
        // should cost a retype, not a whole new OTP.
        Long resetId = otpService.checkOtp(OtpService.MEMBER, memberId, otp).orElse(null);
        if (resetId == null) {
            OtpService.FailureResult attempt = otpService.registerFailure(OtpService.MEMBER, memberId);
            if (attempt.locked()) {
                throw new BusinessException(HttpStatus.TOO_MANY_REQUESTS,
                    "Too many failed attempts. OTP verification is locked for "
                        + attempt.lockedMinutes() + " minutes.");
            }
            throw new BusinessException(HttpStatus.UNAUTHORIZED,
                "Invalid or expired OTP. " + attempt.remaining() + " attempt(s) left.");
        }
        // Behind a valid OTP, so this cannot be used to probe someone's
        // password — and it stops a reset resolving to the password the member
        // has just been unable to remember.
        if (passwordEncoder.matches(newPassword, hashFor(member))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Your new password must be different from your current one.");
        }

        otpService.consumeOtp(resetId);
        otpService.clearFailures(OtpService.MEMBER, memberId);
        // The reset worked, so the escalating resend cost has done its job —
        // start the ladder fresh rather than leaving this member on a long
        // cooldown for the next genuine reset.
        otpService.clearSendHistory(OtpService.MEMBER, memberId);
        portalDao.setPassword(memberId, passwordEncoder.encode(newPassword));
        loginThrottle.clearFailures(loginThrottle.keysFor("member", String.valueOf(member.get("member_code")), request));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Password reset. You can sign in with your new password.");
        return out;
    }

    private void validateNewPassword(String newPassword) {
        if (newPassword == null || newPassword.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "New password is required.");
        }
        // Checked before the length rule: the shipped default is shorter than
        // the minimum, so otherwise a member retyping it would be told to pick
        // something longer rather than why that particular word is refused.
        if (newPassword.equalsIgnoreCase(defaultPassword)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + defaultPassword + "\" is the password every member starts with."
                    + " Please choose something only you know.");
        }
        if (newPassword.length() < MIN_PASSWORD) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Choose a password of at least " + MIN_PASSWORD + " characters.");
        }
    }

    /** The signed-in payload every entry point returns, so they stay in step. */
    private Map<String, Object> session(Map<String, Object> member, Boolean defaultOverride) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("token", jwtService.sign(
            new AuthUser(toLong(member.get("id")), String.valueOf(member.get("member_code")), "member",
                String.valueOf(member.get("name"))),
            MEMBER_TOKEN_TTL));
        out.put("name", member.get("name"));
        out.put("member_code", member.get("member_code"));
        out.put("expires_in", MEMBER_TOKEN_EXPIRY);
        out.put("qr_payload", QR_PREFIX + ":" + member.get("member_code"));
        out.put("password_is_default",
            defaultOverride != null ? defaultOverride : onDefaultPassword(member));
        return out;
    }

    @Override
    public Map<String, Object> me(Long memberId) {
        Map<String, Object> m = portalDao.findPortalMember(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));

        String today = Dates.todayStr();
        String expiryStr = str(m, "membership_expiry");
        boolean expired = expiryStr != null && expiryStr.compareTo(today) < 0;
        long daysLeft = expiryStr == null ? -1 : Math.max(0,
            ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(expiryStr)));
        boolean expiring = expiryStr != null && !expired && daysLeft <= 30;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", m.get("id"));
        out.put("member_code", m.get("member_code"));
        // The portal paints itself from this. Null means the member never
        // chose, so the app follows the device rather than guessing.
        out.put("theme_preference", m.get("theme_preference"));
        out.put("name", m.get("name"));
        out.put("phone", m.get("phone"));
        out.put("email", m.get("email"));
        out.put("gender", m.get("gender"));
        out.put("status", m.get("status"));
        out.put("trainer_name", m.get("trainer_name"));
        out.put("join_date", m.get("join_date"));
        out.put("membership_type", m.get("membership_type"));
        out.put("membership_start", m.get("membership_start"));
        out.put("membership_expiry", m.get("membership_expiry"));
        out.put("days_left", daysLeft);
        out.put("expired", expired);
        out.put("expiring", expiring);
        out.put("membership_fee", toDecimal(m.get("membership_fee")));
        out.put("amount_paid", toDecimal(m.get("amount_paid")));
        out.put("amount_due", toDecimal(m.get("amount_due")).max(BigDecimal.ZERO));
        out.put("payment_mode", m.get("payment_mode"));
        out.put("qr_payload", QR_PREFIX + ":" + m.get("member_code"));
        // Drives the "you are still on the password the whole gym knows"
        // banner. Nothing secret: the member is being told about their own row.
        out.put("password_is_default", onDefaultPassword(m));
        // Personal training. What decides whether the portal shows any of it is
        // whether the member has bought a plan — not whether a trainer happens
        // to be named on their record, which many gyms do for everybody on the
        // floor. Hanging the plans off the trainer also hid them outright if a
        // trainer left and the member was not reassigned.
        out.put("trainer", portalDao.findTrainer(memberId).orElse(null));
        out.put("pt_subscriptions", portalDao.listPtSubscriptions(memberId));
        out.put("pt_sessions", portalDao.listPtSessions(memberId, 50));

        // A locker is the same shape of thing as a training plan: something the
        // member pays for that runs to a date. The portal shows a tab for it
        // only when they actually hold one.
        out.put("locker", portalDao.findLocker(memberId).orElse(null));
        out.put("invoices", portalDao.listInvoices(memberId, 50));

        out.put("workouts", portalDao.listWorkouts(memberId));
        out.put("diet", portalDao.listDiet(memberId));
        out.put("progress", portalDao.listProgress(memberId, 12));
        out.put("attendance", portalDao.listAttendance(memberId, 30));
        // The whole history, not a recent slice: this is the member's own
        // record of what they have paid, and a receipt they cannot reach is
        // not a receipt.
        out.put("payments", portalDao.listPayments(memberId, 200));
        return out;
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static BigDecimal toDecimal(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        try {
            return new BigDecimal(String.valueOf(v));
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private static Long toLong(Object v) {
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }

    /** The three values the column accepts. "system" and null both mean
     *  "follow the device"; they are kept distinct so a member who explicitly
     *  chose to follow their phone is not confused with one who never chose. */
    private static final java.util.Set<String> THEMES = java.util.Set.of("light", "dark", "system");

    @Override
    public Map<String, Object> setThemePreference(Long memberId, String theme) {
        String value = theme == null || theme.isBlank() ? null : theme.trim().toLowerCase();
        if (value != null && !THEMES.contains(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Theme must be one of light, dark or system.");
        }
        portalDao.updateThemePreference(memberId, value);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("theme_preference", value);
        return out;
    }
}
