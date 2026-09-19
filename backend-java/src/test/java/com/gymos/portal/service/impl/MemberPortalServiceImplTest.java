package com.gymos.portal.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.gymos.common.api.BusinessException;
import com.gymos.common.security.JwtService;
import com.gymos.member.dao.ClientDao;
import com.gymos.otp.service.OtpService;
import com.gymos.portal.dao.MemberPortalDao;
import com.gymos.portal.service.MemberPortalService;

@ExtendWith(MockitoExtension.class)
class MemberPortalServiceImplTest {

    private static final String DEFAULT = "admin";

    @Mock MemberPortalDao portalDao;
    @Mock ClientDao clientDao;
    @Mock JwtService jwtService;
    @Mock OtpService otpService;
    @Mock org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    private MemberPortalService svc;

    /** A member who has chosen their own password. */
    private Map<String, Object> member() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 5L);
        m.put("member_code", "101");
        m.put("name", "Bob");
        m.put("phone", "9990000001");
        m.put("email", "bob@example.com");
        m.put("gender", "Male");
        m.put("status", "active");
        m.put("trainer_name", "Trainer One");
        m.put("membership_type", "Monthly");
        m.put("membership_start", "2026-01-01");
        m.put("membership_expiry", "2099-01-01");
        m.put("membership_fee", 1000);
        m.put("amount_paid", 500);
        m.put("amount_due", 500);
        m.put("payment_mode", "Cash");
        m.put("password_hash", "stored-hash");
        m.put("password_set_at", Instant.parse("2026-02-01T00:00:00Z"));
        m.put("must_reset_password", false);
        return m;
    }

    /** A member as the migration leaves them: on the gym default, never changed. */
    private Map<String, Object> memberOnDefault() {
        Map<String, Object> m = member();
        m.put("password_hash", "default-hash");
        m.put("password_set_at", null);
        return m;
    }

    @BeforeEach
    void setUp() {
        when(passwordEncoder.encode(DEFAULT)).thenReturn("default-hash");
        svc = new MemberPortalServiceImpl(portalDao, clientDao, jwtService,
            com.gymos.common.security.TestThrottles.open(), passwordEncoder, otpService,
            new org.springframework.mock.web.MockHttpServletRequest(), DEFAULT);
    }

    // ---------- login ----------

    @Test
    void loginReturnsTokenAndQrPayload() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(passwordEncoder.matches("s3cret", "stored-hash")).thenReturn(true);
        when(jwtService.sign(any(), anyLong())).thenReturn("member-tok");

        Map<String, Object> result = svc.login("101", "s3cret");

        assertEquals("member-tok", result.get("token"));
        assertEquals("101", result.get("member_code"));
        assertEquals("12h", result.get("expires_in"));
        assertEquals("GYMOS:101", result.get("qr_payload"));
        assertEquals(false, result.get("password_is_default"));
    }

    @Test
    void aMemberWhoHasNeverChangedTheirPasswordSignsInOnTheGymDefault() {
        // The whole point of the default: the desk hands over a Member ID and
        // the member is in, with no activation step to walk them through.
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(memberOnDefault()));
        when(passwordEncoder.matches(DEFAULT, "default-hash")).thenReturn(true);
        when(jwtService.sign(any(), anyLong())).thenReturn("member-tok");

        Map<String, Object> result = svc.login("101", DEFAULT);

        assertEquals("member-tok", result.get("token"));
        // ...and the portal is told to nag them about it.
        assertEquals(true, result.get("password_is_default"));
    }

    @Test
    void aMemberRowWithNoHashAtAllStillOpensOnTheGymDefault() {
        // Belt and braces for a row that predates the column default, or an
        // import that wrote NULL: better the gym default than a member locked
        // out of a portal with no way back in.
        Map<String, Object> m = memberOnDefault();
        m.put("password_hash", null);
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(m));
        when(passwordEncoder.matches(DEFAULT, "default-hash")).thenReturn(true);
        when(jwtService.sign(any(), anyLong())).thenReturn("member-tok");

        assertEquals("member-tok", svc.login("101", DEFAULT).get("token"));
    }

    @Test
    void loginWrongPasswordReturns401() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(passwordEncoder.matches("nope", "stored-hash")).thenReturn(false);
        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("101", "nope"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().contains("Incorrect password"), e.getMessage());
    }

    @Test
    void anUnknownMemberIdSaysSoRatherThanBlamingThePassword() {
        when(clientDao.findByMemberCodeFull("999")).thenReturn(Optional.empty());
        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("999", DEFAULT));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().contains("No member found"), e.getMessage());
    }

    @Test
    void theRegisteredPhoneIsNoLongerACredential() {
        // Knowing the ID and the phone number — both easy to obtain — must not
        // open the account. Only the password does.
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(passwordEncoder.matches("9990000001", "stored-hash")).thenReturn(false);
        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("101", "9990000001"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
    }

    @Test
    void loginInactiveMemberReturns403() {
        Map<String, Object> m = member();
        m.put("status", "inactive");
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(m));
        when(passwordEncoder.matches("s3cret", "stored-hash")).thenReturn(true);
        BusinessException e = assertThrows(BusinessException.class, () -> svc.login("101", "s3cret"));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatus());
        assertTrue(e.getMessage().contains("inactive"));
    }

    @Test
    void loginRequiresBothFields() {
        BusinessException e = assertThrows(BusinessException.class, () -> svc.login(null, "s3cret"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
    }

    // ---------- change password ----------

    @Test
    void changePasswordMovesAMemberOffTheDefaultAndSignsThemIn() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(memberOnDefault()));
        when(passwordEncoder.matches(DEFAULT, "default-hash")).thenReturn(true);
        when(passwordEncoder.matches("brand-new", "default-hash")).thenReturn(false);
        when(passwordEncoder.encode("brand-new")).thenReturn("new-hash");
        when(jwtService.sign(any(), anyLong())).thenReturn("member-tok");

        Map<String, Object> out = svc.changePassword("101", DEFAULT, "brand-new");

        verify(portalDao).setPassword(5L, "new-hash");
        assertEquals("member-tok", out.get("token"));
        // They are off the default now, whatever the row said a moment ago.
        assertEquals(false, out.get("password_is_default"));
    }

    @Test
    void changePasswordRejectsTheWrongCurrentPassword() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(passwordEncoder.matches("guess", "stored-hash")).thenReturn(false);
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.changePassword("101", "guess", "brand-new"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        verify(portalDao, never()).setPassword(anyLong(), anyString());
    }

    @Test
    void changePasswordRefusesToSetTheGymDefault() {
        // Otherwise "change your password" is satisfied by typing the one
        // every member in the building already knows.
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.changePassword("101", "s3cret", DEFAULT));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(portalDao, never()).setPassword(anyLong(), anyString());
    }

    @Test
    void changePasswordRefusesTheCurrentPassword() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(passwordEncoder.matches("s3cret", "stored-hash")).thenReturn(true);
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.changePassword("101", "s3cret", "s3cret"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(portalDao, never()).setPassword(anyLong(), anyString());
    }

    @Test
    void changePasswordRejectsAShortOneBeforeTouchingTheDatabase() {
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.changePassword("101", "s3cret", "abc"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(clientDao, never()).findByMemberCodeFull(anyString());
    }

    // ---------- forgot / reset ----------

    @Test
    void recoveryOptionsMasksTheContactsOnFile() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        Map<String, Object> out = svc.recoveryOptions("101");
        assertEquals("bo**@example.com", out.get("email"));
        assertTrue(String.valueOf(out.get("phone")).contains("*"), String.valueOf(out.get("phone")));
    }

    @Test
    void recoveryOptionsForAnUnknownIdAnswersTheSameShape() {
        // An unauthenticated caller must not learn which Member IDs exist from
        // this endpoint — unlike login, there is no wrong-credential case to
        // disambiguate here.
        when(clientDao.findByMemberCodeFull("999")).thenReturn(Optional.empty());
        Map<String, Object> out = svc.recoveryOptions("999");
        assertNull(out.get("email"));
        assertNull(out.get("phone"));
    }

    @Test
    void forgotSendsTheOtpUnderTheMemberScope() {
        // Staff and member ids collide, so an unscoped OTP for member 5 would
        // be a valid reset for staff 5.
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(otpService.resendState(OtpService.MEMBER, 5L))
            .thenReturn(new OtpService.ResendState(true, 0, 1, 60));
        when(otpService.createAndSendOtp(OtpService.MEMBER, 5L, "9990000001", "sms"))
            .thenReturn(new OtpService.OtpDelivery("123456", "console"));
        when(otpService.ttlMinutes()).thenReturn(10);

        Map<String, Object> out = svc.forgot("101", "sms");

        assertEquals("sms", out.get("method"));
        assertEquals(10, out.get("ttl_minutes"));
        assertEquals("123456", out.get("dev_otp"));   // console gateway only
        verify(otpService).createAndSendOtp(OtpService.MEMBER, 5L, "9990000001", "sms");
    }

    @Test
    void forgotHonoursTheResendLadder() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(otpService.resendState(OtpService.MEMBER, 5L))
            .thenReturn(new OtpService.ResendState(false, 600, 4, 600));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.forgot("101", "sms"));
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, e.getStatus());
        assertTrue(e.getMessage().contains("10 minutes"), e.getMessage());
        verify(otpService, never()).createAndSendOtp(anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    void forgotNeedsAContactOnFile() {
        Map<String, Object> m = member();
        m.put("email", null);
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(m));
        BusinessException e = assertThrows(BusinessException.class, () -> svc.forgot("101", "email"));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
    }

    @Test
    void verifyOtpResetSetsTheNewPassword() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(otpService.getLockUntil(OtpService.MEMBER, 5L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.MEMBER, 5L, "123456")).thenReturn(Optional.of(77L));
        when(passwordEncoder.matches("brand-new", "stored-hash")).thenReturn(false);
        when(passwordEncoder.encode("brand-new")).thenReturn("new-hash");

        svc.verifyOtpReset("101", "123456", "brand-new");

        verify(otpService).consumeOtp(77L);
        verify(portalDao).setPassword(5L, "new-hash");
        verify(otpService).clearSendHistory(OtpService.MEMBER, 5L);
    }

    @Test
    void aRejectedNewPasswordDoesNotSpendTheOtp() {
        // Being told "pick a different password" should cost a retype, not a
        // whole new OTP and another trip up the resend ladder.
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(otpService.getLockUntil(OtpService.MEMBER, 5L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.MEMBER, 5L, "123456")).thenReturn(Optional.of(77L));
        when(passwordEncoder.matches("same-again", "stored-hash")).thenReturn(true);

        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.verifyOtpReset("101", "123456", "same-again"));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        verify(otpService, never()).consumeOtp(any());
        verify(portalDao, never()).setPassword(anyLong(), anyString());
    }

    @Test
    void verifyOtpResetWithAWrongCodeCountsAFailure() {
        when(clientDao.findByMemberCodeFull("101")).thenReturn(Optional.of(member()));
        when(otpService.getLockUntil(OtpService.MEMBER, 5L)).thenReturn(null);
        when(otpService.checkOtp(OtpService.MEMBER, 5L, "000000")).thenReturn(Optional.empty());
        when(otpService.registerFailure(OtpService.MEMBER, 5L))
            .thenReturn(new OtpService.FailureResult(false, 3, 0));

        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.verifyOtpReset("101", "000000", "brand-new"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().contains("3 attempt(s) left"), e.getMessage());
    }

    @Test
    void verifyOtpResetForAnUnknownIdLooksLikeABadOtp() {
        when(clientDao.findByMemberCodeFull("999")).thenReturn(Optional.empty());
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.verifyOtpReset("999", "123456", "brand-new"));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertTrue(e.getMessage().contains("Invalid or expired OTP"), e.getMessage());
    }

    // ---------- profile ----------

    @Test
    void meAssemblesProfileAndHistory() {
        Map<String, Object> m = member();
        m.put("membership_expiry", "2020-01-01"); // expired
        when(portalDao.findPortalMember(5L)).thenReturn(Optional.of(m));
        when(portalDao.findTrainer(5L)).thenReturn(Optional.empty());
        when(portalDao.listWorkouts(5L)).thenReturn(List.of(Map.of("exercise", "Squat")));
        when(portalDao.listDiet(5L)).thenReturn(List.of());
        when(portalDao.listProgress(5L, 12)).thenReturn(List.of());
        when(portalDao.listAttendance(5L, 30)).thenReturn(List.of());
        when(portalDao.listPayments(5L, 200)).thenReturn(List.of());

        Map<String, Object> result = svc.me(5L);

        assertEquals("Bob", result.get("name"));
        assertEquals("GYMOS:101", result.get("qr_payload"));
        assertTrue((Boolean) result.get("expired"));
        assertFalse((Boolean) result.get("expiring"));
        assertEquals(0L, result.get("days_left"));
        assertEquals(1, ((List<?>) result.get("workouts")).size());
        assertEquals(false, result.get("password_is_default"));
        verify(portalDao).findPortalMember(5L);
    }

    @Test
    void meFlagsAMemberStillOnTheGymDefault() {
        when(portalDao.findPortalMember(5L)).thenReturn(Optional.of(memberOnDefault()));
        when(portalDao.findTrainer(5L)).thenReturn(Optional.empty());
        when(portalDao.listWorkouts(5L)).thenReturn(List.of());
        when(portalDao.listDiet(5L)).thenReturn(List.of());
        when(portalDao.listProgress(5L, 12)).thenReturn(List.of());
        when(portalDao.listAttendance(5L, 30)).thenReturn(List.of());
        when(portalDao.listPayments(5L, 200)).thenReturn(List.of());

        assertEquals(true, svc.me(5L).get("password_is_default"));
    }

    @Test
    void meExpiringWhenWithin30Days() {
        Map<String, Object> m = member();
        m.put("membership_expiry", java.time.LocalDate.now().plusDays(10).toString());
        when(portalDao.findPortalMember(5L)).thenReturn(Optional.of(m));
        when(portalDao.findTrainer(5L)).thenReturn(Optional.empty());
        when(portalDao.listWorkouts(5L)).thenReturn(List.of());
        when(portalDao.listDiet(5L)).thenReturn(List.of());
        when(portalDao.listProgress(5L, 12)).thenReturn(List.of());
        when(portalDao.listAttendance(5L, 30)).thenReturn(List.of());
        when(portalDao.listPayments(5L, 200)).thenReturn(List.of());

        Map<String, Object> result = svc.me(5L);

        assertFalse((Boolean) result.get("expired"));
        assertTrue((Boolean) result.get("expiring"));
        assertEquals(10L, result.get("days_left"));
    }

    @Test
    void meUnknownMemberReturns404() {
        when(portalDao.findPortalMember(99L)).thenReturn(Optional.empty());
        BusinessException e = assertThrows(BusinessException.class, () -> svc.me(99L));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
    }
}
