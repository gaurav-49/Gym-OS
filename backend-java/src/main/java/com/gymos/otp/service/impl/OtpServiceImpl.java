package com.gymos.otp.service.impl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.gymos.notify.service.NotifyService;
import com.gymos.otp.dao.OtpDao;
import com.gymos.otp.service.OtpService;

/**
 * OTP service — port of the Node otpService.js: 6-digit OTP, SHA-256 hashed at
 * rest, TTL, 5 sends/hour, lockout after 5 failed attempts. All SQL is
 * delegated to {@link com.gymos.otp.dao.OtpDao}.
 */
@Service
public class OtpServiceImpl implements OtpService {

    private final OtpDao otpDao;
    private final NotifyService notifyService;
    /** How far back the resend ladder counts. */
    private static final int LADDER_WINDOW_HOURS = 24;

    private final int ttlMinutes;
    private final int maxSendsPerHour;
    private final String resendLadder;
    private final int maxFailedAttempts;
    private final int lockoutMinutes;
    private final SecureRandom random = new SecureRandom();

    public OtpServiceImpl(OtpDao otpDao,
                          NotifyService notifyService,
                          @Value("${app.otp.ttl-minutes}") int ttlMinutes,
                          @Value("${app.otp.max-sends-per-hour}") int maxSendsPerHour,
                          @Value("${app.otp.resend-ladder:0=60,3=600,5=1200,10=3600,15=86400}") String resendLadder,
                          @Value("${app.otp.max-failed-attempts}") int maxFailedAttempts,
                          @Value("${app.otp.lockout-minutes}") int lockoutMinutes) {
        this.otpDao = otpDao;
        this.notifyService = notifyService;
        this.ttlMinutes = ttlMinutes;
        this.maxSendsPerHour = maxSendsPerHour;
        this.resendLadder = resendLadder;
        this.maxFailedAttempts = maxFailedAttempts;
        this.lockoutMinutes = lockoutMinutes;
    }

    @Override
    public int ttlMinutes() {
        return ttlMinutes;
    }

    @Override
    public OtpDelivery createAndSendOtp(String scope, long userId, String contact, String method) {
        String otp = generateOtp();
        otpDao.insertReset(scope, userId, hashOtp(otp), method,
            Instant.now().plus(Duration.ofMinutes(ttlMinutes)));
        String delivered = "email".equals(method)
            ? notifyService.sendEmail(contact, otp)
            : notifyService.sendSms(contact, otp);
        return new OtpDelivery(otp, delivered);
    }

    @Override
    public boolean verifyOtp(String scope, long userId, String otp) {
        return checkOtp(scope, userId, otp)
            .map(id -> {
                otpDao.markUsed(id);
                return true;
            })
            .orElse(false);
    }

    @Override
    public java.util.Optional<Long> checkOtp(String scope, long userId, String otp) {
        return otpDao.findValidResetId(scope, userId, hashOtp(otp == null ? "" : otp.trim()));
    }

    @Override
    public void consumeOtp(Long resetId) {
        if (resetId != null) {
            otpDao.markUsed(resetId);
        }
    }

    @Override
    public boolean canSendOtp(String scope, long userId) {
        return resendState(scope, userId).allowed();
    }

    /**
     * "sends-so-far = wait-seconds" pairs, lowest first. The wait that applies
     * is the one for the highest threshold the user has reached, so the cost of
     * asking again climbs the more it has already been asked.
     */
    private java.util.NavigableMap<Integer, Long> ladder() {
        java.util.NavigableMap<Integer, Long> steps = new java.util.TreeMap<>();
        for (String pair : resendLadder.split(",")) {
            String[] kv = pair.trim().split("=");
            if (kv.length == 2) {
                steps.put(Integer.parseInt(kv[0].trim()), Long.parseLong(kv[1].trim()));
            }
        }
        if (steps.isEmpty()) {
            steps.put(0, 60L);
        }
        return steps;
    }

    /** The wait that applies once {@code sends} OTPs have already gone out. */
    private long cooldownAfter(int sends) {
        var e = ladder().floorEntry(Math.max(0, sends));
        return e == null ? 60L : e.getValue();
    }

    @Override
    public ResendState resendState(String scope, long userId) {
        // The window is a day: the ladder has to forget eventually, or someone
        // who legitimately reset their password a few times over a year would
        // arrive at the 24-hour rung and be unable to do it again.
        int sends = otpDao.countSendsInLastHours(scope, userId, LADDER_WINDOW_HOURS);
        long cooldown = cooldownAfter(sends);
        Instant last = otpDao.lastSentAt(scope, userId).orElse(null);
        if (last == null || sends == 0) {
            return new ResendState(true, 0, sends, cooldown);
        }
        long elapsed = Duration.between(last, Instant.now()).getSeconds();
        long wait = cooldown - elapsed;
        return wait <= 0
            ? new ResendState(true, 0, sends, cooldown)
            : new ResendState(false, wait, sends, cooldown);
    }

    @Override
    public void clearSendHistory(String scope, long userId) {
        otpDao.clearSendHistory(scope, userId);
    }

    @Override
    public Instant getLockUntil(String scope, long userId) {
        return otpDao.findActiveLock(scope, userId).orElse(null);
    }

    @Override
    public FailureResult registerFailure(String scope, long userId) {
        int current = otpDao.incrementFailures(scope, userId);
        if (current >= maxFailedAttempts) {
            otpDao.applyLock(scope, userId, lockoutMinutes);
            return new FailureResult(true, 0, lockoutMinutes);
        }
        return new FailureResult(false, maxFailedAttempts - current, 0);
    }

    @Override
    public void clearFailures(String scope, long userId) {
        otpDao.clearFailures(scope, userId);
    }

    private String generateOtp() {
        return String.valueOf(random.nextInt(900000) + 100000);
    }

    private String hashOtp(String otp) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(otp.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
