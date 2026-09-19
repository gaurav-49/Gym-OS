package com.gymos.billing.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.gymos.billing.dao.BillingDao;
import com.gymos.billing.service.BillingService;
import com.gymos.common.api.BusinessException;
import com.gymos.notification.dao.NotificationDao;
import com.gymos.notification.service.ReminderService;
import com.gymos.notify.service.NotifyService;
import com.gymos.payment.dao.PaymentDao;

@ExtendWith(MockitoExtension.class)
class BillingServiceImplTest {

    @Mock BillingDao billingDao;
    @Mock NotificationDao notificationDao;
    @Mock PaymentDao paymentDao;
    @Mock ReminderService reminderService;
    @Mock NotifyService notifyService;

    private BillingService svc;

    private Map<String, Object> member(boolean withMethod) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 1L);
        m.put("member_code", "101");
        m.put("name", "Alice");
        m.put("email", "alice@example.com");
        m.put("phone", "9990000001");
        m.put("membership_type", "Monthly");
        m.put("membership_expiry", "2099-01-01");
        m.put("membership_fee", 1000);
        m.put("amount_paid", 0);
        m.put("auto_renew", true);
        m.put("status", "active");
        m.put("recurring_method", withMethod ? "UPI" : null);
        return m;
    }

    @BeforeEach
    void setUp() {
        svc = new BillingServiceImpl(billingDao, notificationDao, paymentDao, reminderService, notifyService);
    }

    private void stubDefaultSettings() {
        when(notificationDao.getSettings()).thenReturn(new LinkedHashMap<>());
    }

    // ---------- settings ----------

    @Test
    void getSettingsUsesDefaults() {
        when(notificationDao.getSettings()).thenReturn(new LinkedHashMap<>());
        Map<String, Object> s = svc.getSettings();
        assertTrue((Boolean) s.get("auto_renew_enabled"));
        assertEquals(3, s.get("auto_renew_retry_days"));
        assertEquals(3, s.get("auto_renew_max_attempts"));
        assertTrue(String.valueOf(s.get("auto_renew_dunning_message")).contains("{amount}"));
    }

    @Test
    void saveSettingsRejectsOutOfRangeRetryDays() {
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.saveSettings(Map.of("auto_renew_retry_days", 99)));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("auto_renew_retry_days must be between 1 and 30", e.getMessage());
    }

    // ---------- attempt cycle ----------

    @Test
    void retryRenewsWhenMethodOnFile() {
        stubDefaultSettings();
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(true)));
        when(billingDao.findAttempt(1L, "2099-01-01")).thenReturn(Optional.empty());
        Map<String, Object> updated = member(true);
        updated.put("amount_paid", 1000);
        when(billingDao.renewClient(eq(1L), eq("2099-01-31"), any(), eq("UPI"))).thenReturn(updated);
        when(reminderService.sendRenewalReceipt(any(), any(), any(), any()))
            .thenReturn(new ReminderService.NotifyDelivery("console", "alice@example.com"));

        Map<String, Object> result = svc.retryMember(1L);

        assertEquals("renewed", result.get("status"));
        assertEquals("2099-01-31", result.get("new_expiry"));
        assertEquals("console", result.get("receipt"));
        verify(paymentDao).insert(eq(1L), any(), eq(java.time.LocalDate.now().toString()), eq("UPI"),
            eq("Auto-renewal"), any());
        verify(billingDao).upsertAttempt(eq(1L), eq("2099-01-01"), any(), eq("UPI"), eq("success"), eq(1),
            eq(null), eq(null), any());
    }

    @Test
    void retryFailsWithoutMethodAndSchedulesRetry() {
        stubDefaultSettings();
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(false)));
        when(billingDao.findAttempt(1L, "2099-01-01")).thenReturn(Optional.empty());
        when(notifyService.sendNotificationEmail(eq("alice@example.com"), any(), any()))
            .thenReturn(new NotifyService.Delivery("console", "alice@example.com"));
        when(notifyService.sendWhatsApp(eq("9990000001"), any()))
            .thenReturn(new NotifyService.Delivery("console", "9990000001"));

        Map<String, Object> result = svc.retryMember(1L);

        assertEquals("failed", result.get("status"));
        assertEquals(1, result.get("attempt_count"));
        assertFalse((Boolean) result.get("paused"));
        assertTrue((Boolean) result.get("dunning_sent"));
        verify(billingDao).upsertAttempt(eq(1L), eq("2099-01-01"), any(), eq(null), eq("failed"), eq(1),
            org.mockito.ArgumentMatchers.any(), eq("No recurring payment method on file"), eq(null));
        verify(billingDao, never()).pauseClient(1L);
    }

    @Test
    void retryPausesAfterMaxAttempts() {
        stubDefaultSettings();
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(false)));
        Map<String, Object> existing = new LinkedHashMap<>();
        existing.put("status", "failed");
        existing.put("attempt_count", 3);
        existing.put("next_retry_at", null);
        when(billingDao.findAttempt(1L, "2099-01-01")).thenReturn(Optional.of(existing));
        when(notifyService.sendNotificationEmail(eq("alice@example.com"), any(), any()))
            .thenReturn(new NotifyService.Delivery("failed", "alice@example.com"));
        when(notifyService.sendWhatsApp(eq("9990000001"), any()))
            .thenReturn(new NotifyService.Delivery("failed", "9990000001"));

        Map<String, Object> result = svc.retryMember(1L);

        assertEquals(4, result.get("attempt_count"));
        assertTrue((Boolean) result.get("paused"));
        verify(billingDao).pauseClient(1L);
        verify(billingDao).upsertAttempt(eq(1L), eq("2099-01-01"), any(), eq(null), eq("failed"), eq(4),
            eq(null), eq("No recurring payment method on file"), eq(null));
    }

    @Test
    void retryNotDueWhenNextRetryInFuture() {
        stubDefaultSettings();
        // retryMember always forces; the retry schedule only applies to the
        // hourly job — so exercise that path (runAutoRenewCheck → attemptCycle).
        when(billingDao.findDueMembers(0)).thenReturn(java.util.List.of(member(false)));
        Map<String, Object> existing = new LinkedHashMap<>();
        existing.put("status", "failed");
        existing.put("attempt_count", 1);
        existing.put("next_retry_at", new Timestamp(System.currentTimeMillis() + 86400000L));
        when(billingDao.findAttempt(1L, "2099-01-01")).thenReturn(Optional.of(existing));

        Map<String, Object> result = svc.runAutoRenewCheck();

        assertEquals(1, result.get("due"));
        assertEquals(0, result.get("renewed"));
        assertEquals(0, result.get("failed"));
        verify(billingDao, never()).upsertAttempt(any(), any(), any(), any(), any(), anyInt(), any(), any(), any());
    }

    @Test
    void alreadyRenewedIsSkipped() {
        stubDefaultSettings();
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(true)));
        when(billingDao.findAttempt(1L, "2099-01-01"))
            .thenReturn(Optional.of(Map.of("status", "success")));

        Map<String, Object> result = svc.retryMember(1L);

        assertEquals("already_renewed", result.get("status"));
        verify(billingDao, never()).upsertAttempt(any(), any(), any(), any(), any(), anyInt(), any(), any(), any());
    }

    @Test
    void retryUnknownMemberReturns404() {
        when(billingDao.findClientById(99L)).thenReturn(Optional.empty());
        BusinessException e = assertThrows(BusinessException.class, () -> svc.retryMember(99L));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
    }

    // ---------- hourly job ----------

    @Test
    void runAutoRenewCheckDisabledDoesNothing() {
        when(notificationDao.getSettings())
            .thenReturn(new LinkedHashMap<>(Map.of("auto_renew_enabled", "false")));
        Map<String, Object> r = svc.runAutoRenewCheck();
        assertEquals(false, r.get("enabled"));
        verify(billingDao, never()).findDueMembers(anyInt());
    }

    @Test
    void runAutoRenewCheckCountsRenewals() {
        stubDefaultSettings();
        when(billingDao.findDueMembers(0)).thenReturn(java.util.List.of(member(true)));
        when(billingDao.findAttempt(1L, "2099-01-01")).thenReturn(Optional.empty());
        when(billingDao.renewClient(eq(1L), eq("2099-01-31"), any(), eq("UPI"))).thenReturn(member(true));

        Map<String, Object> r = svc.runAutoRenewCheck();

        assertEquals(true, r.get("enabled"));
        assertEquals(1, r.get("due"));
        assertEquals(1, r.get("renewed"));
        assertEquals(0, r.get("failed"));
    }

    // ---------- staff actions ----------

    @Test
    void markPaidForcesRenewal() {
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(true)));
        when(billingDao.renewClient(eq(1L), eq("2099-01-31"), any(), eq("Cash"))).thenReturn(member(true));
        when(reminderService.sendRenewalReceipt(any(), any(), any(), any()))
            .thenReturn(new ReminderService.NotifyDelivery("console", "alice@example.com"));

        Map<String, Object> result = svc.markPaid(1L, "1000", "Cash");

        assertNotNull(result.get("member"));
        assertEquals("2099-01-31", result.get("new_expiry"));
        assertEquals("console", result.get("receipt"));
        verify(paymentDao).insert(eq(1L), any(), any(), eq("Cash"), eq("Auto-renewal (manual collection)"), any());
    }

    @Test
    void pauseMemberCancelsRetries() {
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(member(true)));
        Map<String, Object> result = svc.pauseMember(1L);
        assertEquals("Auto-renew paused for Alice.", result.get("message"));
        verify(billingDao).pauseClient(1L);
        verify(billingDao).cancelPendingRetries(1L);
    }

    @Test
    void setMemberBillingRejectsAutoRenewForInactive() {
        Map<String, Object> m = member(true);
        m.put("status", "inactive");
        when(billingDao.findClientById(1L)).thenReturn(Optional.of(m));

        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.setMemberBilling(1L, Map.of("auto_renew", "true")));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().contains("the member is inactive"));
    }
}
