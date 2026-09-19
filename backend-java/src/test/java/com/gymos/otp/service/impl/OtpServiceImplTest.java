package com.gymos.otp.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.gymos.notify.service.NotifyService;
import com.gymos.otp.dao.OtpDao;
import com.gymos.otp.service.OtpService;

@ExtendWith(MockitoExtension.class)
class OtpServiceImplTest {

    @Mock OtpDao otpDao;
    @Mock NotifyService notifyService;

    private OtpServiceImpl svc;

    @BeforeEach
    void setUp() {
        svc = new OtpServiceImpl(otpDao, notifyService, 10, 5, "0=60,3=600,5=1200,10=3600,15=86400", 5, 15);
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void ttlMinutesIsExposed() {
        assertEquals(10, svc.ttlMinutes());
    }

    @Test
    void createAndSendOtpInsertsHashedResetWithTtlAndDeliversViaEmail() {
        when(notifyService.sendEmail(eq("admin@gym.local"), anyString())).thenReturn("console");

        OtpService.OtpDelivery delivery = svc.createAndSendOtp(OtpService.STAFF, 1L, "admin@gym.local", "email");

        assertEquals("console", delivery.delivered());
        assertTrue(delivery.otp().matches("\\d{6}"), "OTP must be 6 digits");

        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Instant> expiresCaptor = ArgumentCaptor.forClass(Instant.class);
        verify(otpDao).insertReset(eq(OtpService.STAFF), eq(1L), hashCaptor.capture(), eq("email"), expiresCaptor.capture());

        // OTP is stored as its SHA-256 hash, never in plain text.
        assertEquals(sha256(delivery.otp()), hashCaptor.getValue());

        // Expiry is TTL minutes in the future.
        Instant expires = expiresCaptor.getValue();
        assertTrue(expires.isAfter(Instant.now().plus(Duration.ofMinutes(9))));
        assertTrue(expires.isBefore(Instant.now().plus(Duration.ofMinutes(11))));
    }

    @Test
    void createAndSendOtpDeliversViaSms() {
        when(notifyService.sendSms(eq("9990000001"), anyString())).thenReturn("console");
        OtpService.OtpDelivery delivery = svc.createAndSendOtp(OtpService.STAFF, 1L, "9990000001", "sms");
        assertEquals("console", delivery.delivered());
        verify(notifyService).sendSms(eq("9990000001"), eq(delivery.otp()));
    }

    /** Configure the DAO to look like {@code sends} OTPs, the last one just now. */
    private void sentJustNow(int sends) {
        when(otpDao.countSendsInLastHours(eq(OtpService.STAFF), eq(1L), anyInt())).thenReturn(sends);
        when(otpDao.lastSentAt(OtpService.STAFF, 1L)).thenReturn(Optional.of(Instant.now()));
    }

    @Test
    void theFirstSendIsAlwaysAllowed() {
        when(otpDao.countSendsInLastHours(eq(OtpService.STAFF), eq(1L), anyInt())).thenReturn(0);
        when(otpDao.lastSentAt(OtpService.STAFF, 1L)).thenReturn(Optional.empty());
        assertTrue(svc.resendState(OtpService.STAFF, 1L).allowed());
    }

    @Test
    void eachRungOfTheResendLadderCostsMore() {
        // sends already made → the wait before the next one
        record Rung(int sends, long seconds) { }
        for (Rung r : new Rung[] {
                new Rung(1, 60),        // 1 minute
                new Rung(2, 60),
                new Rung(3, 600),       // 10 minutes
                new Rung(4, 600),
                new Rung(5, 1200),      // 20 minutes
                new Rung(9, 1200),
                new Rung(10, 3600),     // 1 hour
                new Rung(14, 3600),
                new Rung(15, 86400),    // 24 hours
                new Rung(40, 86400) }) {
            sentJustNow(r.sends());
            OtpService.ResendState st = svc.resendState(OtpService.STAFF, 1L);
            assertFalse(st.allowed(), "send #" + r.sends() + " should still be cooling down");
            assertEquals(r.seconds(), st.cooldownSeconds(),
                "wrong cooldown after " + r.sends() + " sends");
            // The countdown is the cooldown minus the (near-zero) elapsed time.
            assertTrue(st.waitSeconds() > r.seconds() - 5 && st.waitSeconds() <= r.seconds(),
                "wait " + st.waitSeconds() + " not close to " + r.seconds());
        }
    }

    @Test
    void theWaitExpiresAndTheSendIsAllowedAgain() {
        when(otpDao.countSendsInLastHours(eq(OtpService.STAFF), eq(1L), anyInt())).thenReturn(2);
        when(otpDao.lastSentAt(OtpService.STAFF, 1L)).thenReturn(Optional.of(Instant.now().minusSeconds(61)));
        assertTrue(svc.resendState(OtpService.STAFF, 1L).allowed(), "a minute has passed, so a resend is due");
    }

    @Test
    void aSuccessfulResetForgetsTheLadder() {
        svc.clearSendHistory(OtpService.STAFF, 1L);
        verify(otpDao).clearSendHistory(OtpService.STAFF, 1L);
    }

    @Test
    void verifyOtpMarksValidResetUsed() {
        when(otpDao.findValidResetId(OtpService.STAFF, 1L, sha256("123456"))).thenReturn(Optional.of(9L));
        assertTrue(svc.verifyOtp(OtpService.STAFF, 1L, "123456"));
        verify(otpDao).markUsed(9L);
    }

    @Test
    void verifyOtpRejectsInvalidOrMissingCode() {
        when(otpDao.findValidResetId(eq(OtpService.STAFF), eq(1L), anyString())).thenReturn(Optional.empty());
        assertFalse(svc.verifyOtp(OtpService.STAFF, 1L, "000000"));
        assertFalse(svc.verifyOtp(OtpService.STAFF, 1L, null));
    }

    @Test
    void getLockUntilDelegatesToDao() {
        Instant lock = Instant.now().plusSeconds(600);
        when(otpDao.findActiveLock(OtpService.STAFF, 1L)).thenReturn(Optional.of(lock));
        assertEquals(lock, svc.getLockUntil(OtpService.STAFF, 1L));
        when(otpDao.findActiveLock(OtpService.STAFF, 1L)).thenReturn(Optional.empty());
        assertNull(svc.getLockUntil(OtpService.STAFF, 1L));
    }

    @Test
    void registerFailureBelowThresholdReportsRemaining() {
        when(otpDao.incrementFailures(OtpService.STAFF, 1L)).thenReturn(3);
        OtpService.FailureResult res = svc.registerFailure(OtpService.STAFF, 1L);
        assertFalse(res.locked());
        assertEquals(2, res.remaining());
    }

    @Test
    void registerFailureAtThresholdLocksTheUser() {
        when(otpDao.incrementFailures(OtpService.STAFF, 1L)).thenReturn(5);
        OtpService.FailureResult res = svc.registerFailure(OtpService.STAFF, 1L);
        assertTrue(res.locked());
        assertEquals(15, res.lockedMinutes());
        verify(otpDao).applyLock(OtpService.STAFF, 1L, 15);
    }

    @Test
    void clearFailuresDelegatesToDao() {
        svc.clearFailures(OtpService.STAFF, 1L);
        verify(otpDao).clearFailures(OtpService.STAFF, 1L);
    }
}
