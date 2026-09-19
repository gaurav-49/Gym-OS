package com.gymos.auth.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.function.Executable;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.gymos.auth.dao.UserDao;
import com.gymos.auth.dto.ForgotResponse;
import com.gymos.auth.dto.LoginResponse;
import com.gymos.auth.dto.RecoveryOptionsResponse;
import com.gymos.auth.entity.User;
import com.gymos.auth.service.AuthService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.security.JwtService;
import com.gymos.common.security.PasswordPolicy;
import com.gymos.common.security.TestThrottles;
import com.gymos.otp.service.OtpService;

import org.springframework.mock.web.MockHttpServletRequest;

@ExtendWith(MockitoExtension.class)
class AuthServiceImplTest {

    @Mock UserDao userDao;
    @Mock OtpService otpService;
    @Mock JwtService jwtService;
    @Mock PasswordEncoder passwordEncoder;
    PasswordPolicy policy;

    private AuthService auth;
    private TestThrottles.Counting throttle;

    private final User admin = new User(1L, "admin", "hash", "Administrator", "admin",
        "admin@gym.local", "9990000001", Instant.parse("2026-01-01T00:00:00Z"), false);

    @BeforeEach
    void setUp() {
        throttle = TestThrottles.counting();
        policy = new PasswordPolicy(userDao, passwordEncoder, 6, 5);
        auth = new AuthServiceImpl(userDao, otpService, jwtService, passwordEncoder,
            throttle, policy, new MockHttpServletRequest());
    }

    private static void assertBusiness(HttpStatus status, Executable ex) {
        BusinessException e = assertThrows(BusinessException.class, ex);
        assertEquals(status, e.getStatus(), "unexpected status for: " + e.getMessage());
    }

    // ---------- login ----------

    @Test
    void loginSuccessReturnsTokenAndUser() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("secret1", "hash")).thenReturn(true);
        when(jwtService.sign(any())).thenReturn("tok-123");

        LoginResponse res = auth.login("admin", "secret1");

        assertEquals("tok-123", res.token());
        assertEquals(1L, res.user().id());
        assertEquals("admin", res.user().role());
    }

    @Test
    void loginRequiresBothFields() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.login(null, "x"));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.login("admin", null));
    }

    @Test
    void loginUnknownUserReturns401NotFound404() {
        // 2.0: a 404 here told an attacker the username does not exist.
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        assertBusiness(HttpStatus.UNAUTHORIZED, () -> auth.login("nobody", "x"));
    }

    @Test
    void loginWrongPasswordReturns401() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);
        assertBusiness(HttpStatus.UNAUTHORIZED, () -> auth.login("admin", "wrong"));
    }

    // ---------- 2.0: enumeration + brute force ----------

    @Test
    void unknownUserAndWrongPasswordSayWhichOneWasWrong() {
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        String unknown = assertThrows(BusinessException.class,
            () -> auth.login("nobody", "x")).getMessage();

        setUp(); // reset the failure counter so the countdown matches
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);
        String wrongPass = assertThrows(BusinessException.class,
            () -> auth.login("admin", "wrong")).getMessage();

        assertNotEquals(wrongPass, unknown, "the two cases are deliberately distinguishable");
        assertTrue(unknown.toLowerCase().contains("no account found"), unknown);
        assertTrue(wrongPass.toLowerCase().contains("incorrect password"), wrongPass);
        // The countdown belongs only on the branch where the account exists —
        // otherwise it tells a prober how close the IP is to being locked.
        assertTrue(wrongPass.contains("attempt(s) left"), wrongPass);
        assertFalse(unknown.contains("attempt(s) left"), unknown);
    }

    @Test
    void unknownUsernamesAreThrottledToo() {
        // This is what keeps enumeration expensive now that the replies differ:
        // a username that does not exist still burns the five-strike budget.
        TestThrottles.Counting counting = TestThrottles.counting();
        AuthService svc = new AuthServiceImpl(userDao, otpService, jwtService, passwordEncoder,
            counting, policy, new MockHttpServletRequest());
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());

        assertThrows(BusinessException.class, () -> svc.login("nobody", "x"));
        assertThrows(BusinessException.class, () -> svc.login("nobody", "y"));

        assertEquals(2, counting.failures(), "unknown usernames must count against the throttle");
    }

    @Test
    void spendingTheAllowanceForcesAPasswordResetRatherThanAWait() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches(anyString(), eq("hash"))).thenReturn(false);
        AuthService svc = new AuthServiceImpl(userDao, otpService, jwtService, passwordEncoder,
            TestThrottles.exhaustOnFailure(), policy, new MockHttpServletRequest());

        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("admin", "wrong"));

        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertTrue(e.getMessage().contains(AuthServiceImpl.PASSWORD_RESET_REQUIRED), e.getMessage());
        verify(userDao).setMustResetPassword(1L, true);
        // No timed lockout is offered to the user anywhere in the message.
        assertFalse(e.getMessage().toLowerCase().contains("minute"), e.getMessage());
        assertFalse(e.getMessage().toLowerCase().contains("locked for"), e.getMessage());
    }

    @Test
    void anUnknownUsernameIsNeverFlaggedOrLocked() {
        when(userDao.findByUsername("ghost")).thenReturn(Optional.empty());
        AuthService svc = new AuthServiceImpl(userDao, otpService, jwtService, passwordEncoder,
            TestThrottles.exhaustOnFailure(), policy, new MockHttpServletRequest());

        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("ghost", "x"));

        // There is no account to flag, and no lock to apply — just the reply.
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        verify(userDao, never()).setMustResetPassword(anyLong(), anyBoolean());
    }

    @Test
    void aFlaggedAccountCannotSignInEvenWithTheRightPassword() {
        User flagged = new User(1L, "admin", "hash", "Administrator", "admin",
            "admin@gym.local", "9990000001", null, true);
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(flagged));
        when(passwordEncoder.matches("secret1", "hash")).thenReturn(true);

        BusinessException e = assertThrows(BusinessException.class, () -> auth.login("admin", "secret1"));

        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertTrue(e.getMessage().contains(AuthServiceImpl.PASSWORD_RESET_REQUIRED), e.getMessage());
    }

    @Test
    void aRejectedNewPasswordDoesNotSpendTheOtp() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.getLockUntil(OtpService.STAFF, 1L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.STAFF, 1L, "123456")).thenReturn(Optional.of(77L));
        // The candidate is the password already on the account.
        when(userDao.recentPasswordHashes(1L, 5)).thenReturn(List.of("hash"));
        when(passwordEncoder.matches("oldpass1", "hash")).thenReturn(true);

        BusinessException e = assertThrows(BusinessException.class,
            () -> auth.verifyOtpReset("admin", "123456", "oldpass1"));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().toLowerCase().contains("different"), e.getMessage());
        verify(otpService, never()).consumeOtp(anyLong());
        verify(userDao, never()).changePassword(anyLong(), anyString());
    }

    @Test
    void unknownUserStillRunsAPasswordCompare() {
        // Skipping the compare would make the unknown-user path measurably
        // faster, leaking exactly what the shared message hides.
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        assertThrows(BusinessException.class, () -> auth.login("nobody", "x"));
        verify(passwordEncoder).matches(eq("x"), anyString());
    }

    @Test
    void theFifthFailureDemandsANewPasswordInsteadOfLockingTheAccount() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);
        for (int i = 0; i < 4; i++) {
            assertBusiness(HttpStatus.UNAUTHORIZED, () -> auth.login("admin", "wrong"));
        }
        // 403 "set a new password", not 429 "come back later".
        assertBusiness(HttpStatus.FORBIDDEN, () -> auth.login("admin", "wrong"));
        verify(userDao).setMustResetPassword(1L, true);
    }

    @Test
    void thereIsNoTimedLockoutOnAnyLoginReply() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);
        for (int i = 0; i < 5; i++) {
            String msg = assertThrows(BusinessException.class,
                () -> auth.login("admin", "wrong")).getMessage().toLowerCase();
            assertFalse(msg.contains("try again in"), msg);
            assertFalse(msg.contains("locked for"), msg);
            assertFalse(msg.contains("minute"), msg);
        }
    }

    @Test
    void aSuccessfulLoginClearsTheCounter() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(passwordEncoder.matches("wrong", "hash")).thenReturn(false);
        assertBusiness(HttpStatus.UNAUTHORIZED, () -> auth.login("admin", "wrong"));
        assertEquals(1, throttle.failures());

        when(passwordEncoder.matches("secret1", "hash")).thenReturn(true);
        when(jwtService.sign(any())).thenReturn("tok");
        auth.login("admin", "secret1");
        assertEquals(0, throttle.failures());
        assertEquals(1, throttle.cleared());
    }

    // ---------- recovery options ----------

    @Test
    void recoveryOptionsMasksContacts() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        RecoveryOptionsResponse res = auth.recoveryOptions("admin");
        assertEquals("ad***@gym.local", res.email());
        assertEquals("99****01", res.phone());
    }

    @Test
    void recoveryOptionsUnknownUserReturnsNulls() {
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        RecoveryOptionsResponse res = auth.recoveryOptions("nobody");
        assertNull(res.email());
        assertNull(res.phone());
    }

    // ---------- forgot ----------

    @Test
    void forgotRequiresUsernameAndMethod() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.forgot(null, "email"));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.forgot("admin", null));
    }

    @Test
    void forgotRejectsInvalidMethod() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.forgot("admin", "carrier-pigeon"));
    }

    @Test
    void forgotUnknownUserReturns400() {
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.forgot("nobody", "email"));
    }

    @Test
    void forgotUserWithoutThatContactReturns400() {
        User noEmail = new User(2L, "bob", "h", "Bob", "trainer", null, "9990000001",
            Instant.parse("2026-01-01T00:00:00Z"), false);
        when(userDao.findByUsername("bob")).thenReturn(Optional.of(noEmail));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.forgot("bob", "email"));
    }

    @Test
    void forgotRateLimitedReturns429() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.resendState(OtpService.STAFF, 1L)).thenReturn(new OtpService.ResendState(false, 42, 3, 600));
        assertBusiness(HttpStatus.TOO_MANY_REQUESTS, () -> auth.forgot("admin", "email"));
        verify(otpService, never()).createAndSendOtp(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void forgotEmailInConsoleModeExposesDevOtp() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.resendState(OtpService.STAFF, 1L)).thenReturn(new OtpService.ResendState(true, 0, 1, 60));
        when(otpService.createAndSendOtp(OtpService.STAFF, 1L, "admin@gym.local", "email"))
            .thenReturn(new OtpService.OtpDelivery("123456", "console"));
        when(otpService.ttlMinutes()).thenReturn(10);

        ForgotResponse res = auth.forgot("admin", "email");

        assertEquals("OTP sent to your email.", res.message());
        assertEquals("email", res.method());
        assertEquals("ad***@gym.local", res.destinationMasked());
        assertEquals(10, res.expiresMinutes());
        assertEquals("123456", res.devOtp());
    }

    @Test
    void forgotSmsInConsoleModeExposesDevOtp() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.resendState(OtpService.STAFF, 1L)).thenReturn(new OtpService.ResendState(true, 0, 1, 60));
        when(otpService.createAndSendOtp(OtpService.STAFF, 1L, "9990000001", "sms"))
            .thenReturn(new OtpService.OtpDelivery("654321", "console"));
        when(otpService.ttlMinutes()).thenReturn(10);

        ForgotResponse res = auth.forgot("admin", "sms");

        assertEquals("OTP sent to your phone.", res.message());
        assertEquals("99****01", res.destinationMasked());
        assertEquals("654321", res.devOtp());
    }

    @Test
    void forgotGatewayFailureReturns500() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.resendState(OtpService.STAFF, 1L)).thenReturn(new OtpService.ResendState(true, 0, 1, 60));
        when(otpService.createAndSendOtp(OtpService.STAFF, 1L, "admin@gym.local", "email"))
            .thenThrow(new IllegalStateException("smtp down"));
        assertBusiness(HttpStatus.INTERNAL_SERVER_ERROR, () -> auth.forgot("admin", "email"));
    }

    // ---------- verify OTP / password reset ----------

    @Test
    void verifyOtpRequiresAllFields() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.verifyOtpReset(null, "123456", "newpass1"));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.verifyOtpReset("admin", null, "newpass1"));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.verifyOtpReset("admin", "123456", null));
    }

    @Test
    void verifyOtpRejectsShortPassword() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> auth.verifyOtpReset("admin", "123456", "abc"));
    }

    @Test
    void verifyOtpUnknownUserLooksLikeABadOtp() {
        // 2.0: a 404 confirmed the username did not exist. An unknown account
        // now gets the same 401 and the same wording as a wrong OTP.
        when(userDao.findByUsername("nobody")).thenReturn(Optional.empty());
        BusinessException e = assertThrows(BusinessException.class,
            () -> auth.verifyOtpReset("nobody", "123456", "newpass1"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().toLowerCase().contains("invalid or expired otp"), e.getMessage());
    }

    @Test
    void verifyOtpWhileLockedReturns429() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.getLockUntil(OtpService.STAFF, 1L)).thenReturn(Instant.now().plusSeconds(900));
        assertBusiness(HttpStatus.TOO_MANY_REQUESTS, () -> auth.verifyOtpReset("admin", "123456", "newpass1"));
        verify(otpService, never()).verifyOtp(anyString(), anyLong(), anyString());
    }

    @Test
    void verifyOtpWrongCodeReturns401WithRemaining() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.getLockUntil(OtpService.STAFF, 1L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.STAFF, 1L, "000000")).thenReturn(Optional.empty());
        when(otpService.registerFailure(OtpService.STAFF, 1L)).thenReturn(new OtpService.FailureResult(false, 3, 0));

        BusinessException e = assertThrows(BusinessException.class,
            () -> auth.verifyOtpReset("admin", "000000", "newpass1"));

        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().contains("3 attempt(s) left"), e.getMessage());
    }

    @Test
    void verifyOtpWrongCodeLocksAfterMaxAttempts() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.getLockUntil(OtpService.STAFF, 1L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.STAFF, 1L, "000000")).thenReturn(Optional.empty());
        when(otpService.registerFailure(OtpService.STAFF, 1L)).thenReturn(new OtpService.FailureResult(true, 0, 15));

        BusinessException e = assertThrows(BusinessException.class,
            () -> auth.verifyOtpReset("admin", "000000", "newpass1"));

        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        assertTrue(e.getMessage().contains("locked for 15 minutes"), e.getMessage());
    }

    @Test
    void verifyOtpSuccessResetsThePassword() {
        when(userDao.findByUsername("admin")).thenReturn(Optional.of(admin));
        when(otpService.getLockUntil(OtpService.STAFF, 1L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.STAFF, 1L, "123456")).thenReturn(Optional.of(77L));
        when(userDao.recentPasswordHashes(1L, 5)).thenReturn(List.of());
        when(passwordEncoder.encode("newpass1")).thenReturn("newhash");

        auth.verifyOtpReset("admin", "123456", "newpass1");

        verify(otpService).consumeOtp(77L);
        verify(otpService).clearFailures(OtpService.STAFF, 1L);
        // changePassword owns the column, the history row and the reset flag.
        verify(userDao).changePassword(1L, "newhash");
    }
}
