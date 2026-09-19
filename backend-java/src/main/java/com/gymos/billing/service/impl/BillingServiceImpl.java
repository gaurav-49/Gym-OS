package com.gymos.billing.service.impl;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.billing.dao.BillingDao;
import com.gymos.billing.service.BillingService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.notification.dao.NotificationDao;
import com.gymos.notification.service.ReminderService;
import com.gymos.notify.service.NotifyService;
import com.gymos.payment.dao.PaymentContext;
import com.gymos.payment.dao.PaymentDao;

/**
 * Recurring billing — exact messages/statuses from billingService.js. There is
 * no live payment gateway yet: a charge "succeeds" when a recurring method is
 * on file (dev simulation), like the OTP/reminder console mode. The settings
 * table is shared with the reminder service (common code).
 */
@Service
public class BillingServiceImpl implements BillingService {

    private static final Map<String, String> DEFAULTS = Map.ofEntries(
        Map.entry("auto_renew_enabled", "true"),
        Map.entry("auto_renew_days_before", "0"),
        Map.entry("auto_renew_retry_days", "3"),
        Map.entry("auto_renew_max_attempts", "3"),
        Map.entry("auto_renew_dunning_message",
            "Hi {name}, your auto-renewal of ₹{amount} could not be processed ({error})."
                + " Please update your payment method to keep your membership active. — GYM OS"));

    private final BillingDao billingDao;
    private final NotificationDao notificationDao;
    private final PaymentDao paymentDao;
    private final ReminderService reminderService;
    private final NotifyService notifyService;

    public BillingServiceImpl(BillingDao billingDao, NotificationDao notificationDao, PaymentDao paymentDao,
                              ReminderService reminderService, NotifyService notifyService) {
        this.billingDao = billingDao;
        this.notificationDao = notificationDao;
        this.paymentDao = paymentDao;
        this.reminderService = reminderService;
        this.notifyService = notifyService;
    }

    // ---- settings ---------------------------------------------------------------

    @Override
    public Map<String, Object> getSettings() {
        Map<String, String> map = notificationDao.getSettings();
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("auto_renew_enabled",
            !"false".equals(map.getOrDefault("auto_renew_enabled", DEFAULTS.get("auto_renew_enabled"))));
        s.put("auto_renew_days_before", clamp(map.get("auto_renew_days_before"), 0, 0, 30));
        s.put("auto_renew_retry_days", clamp(map.get("auto_renew_retry_days"), 3, 1, 30));
        s.put("auto_renew_max_attempts", clamp(map.get("auto_renew_max_attempts"), 3, 1, 10));
        s.put("auto_renew_dunning_message",
            map.getOrDefault("auto_renew_dunning_message", DEFAULTS.get("auto_renew_dunning_message")).trim());
        return s;
    }

    @Override
    public Map<String, Object> saveSettings(Map<String, Object> input) {
        Map<String, Object> next = new LinkedHashMap<>(getSettings());
        if (input == null) input = Map.of();

        validateIntRange(input, "auto_renew_days_before", 0, 30,
            "auto_renew_days_before must be between 0 and 30", next);
        validateIntRange(input, "auto_renew_retry_days", 1, 30,
            "auto_renew_retry_days must be between 1 and 30", next);
        validateIntRange(input, "auto_renew_max_attempts", 1, 10,
            "auto_renew_max_attempts must be between 1 and 10", next);
        if (input.containsKey("auto_renew_enabled")) {
            next.put("auto_renew_enabled", "true".equals(String.valueOf(input.get("auto_renew_enabled"))));
        }
        if (input.containsKey("auto_renew_dunning_message")
            && String.valueOf(input.get("auto_renew_dunning_message")).trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "auto_renew_dunning_message cannot be empty");
        }

        notificationDao.upsertSetting("auto_renew_enabled", String.valueOf(next.get("auto_renew_enabled")));
        notificationDao.upsertSetting("auto_renew_days_before", String.valueOf(next.get("auto_renew_days_before")));
        notificationDao.upsertSetting("auto_renew_retry_days", String.valueOf(next.get("auto_renew_retry_days")));
        notificationDao.upsertSetting("auto_renew_max_attempts", String.valueOf(next.get("auto_renew_max_attempts")));
        notificationDao.upsertSetting("auto_renew_dunning_message", String.valueOf(next.get("auto_renew_dunning_message")));
        return next;
    }

    private static void validateIntRange(Map<String, Object> input, String key, int min, int max,
                                         String message, Map<String, Object> next) {
        if (!input.containsKey(key)) return;
        int n = toInt(input.get(key));
        if (n < min || n > max) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, message);
        }
        next.put(key, n);
    }

    // ---- the charge --------------------------------------------------------------

    private Map<String, Object> attemptCycle(Map<String, Object> member, boolean force) {
        Map<String, Object> settings = getSettings();
        String cycle = str(member, "membership_expiry");
        Map<String, Object> existing = billingDao.findAttempt(toLong(member.get("id")), cycle).orElse(null);

        if (existing != null && "success".equals(existing.get("status"))) {
            return Map.of("status", "already_renewed");
        }
        if (!force && existing != null && "failed".equals(existing.get("status"))
            && existing.get("next_retry_at") != null
            && ((Timestamp) existing.get("next_retry_at")).getTime() > System.currentTimeMillis()) {
            return Map.of("status", "retry_not_due");
        }

        int attemptCount = existing != null ? ((Number) existing.get("attempt_count")).intValue() + 1 : 1;
        int maxAttempts = toInt(settings.get("auto_renew_max_attempts"));

        // No saved payment method → the charge fails.
        if (member.get("recurring_method") == null || String.valueOf(member.get("recurring_method")).isBlank()) {
            String error = "No recurring payment method on file";
            Timestamp nextRetry = attemptCount < maxAttempts
                ? new Timestamp(System.currentTimeMillis()
                    + (long) toInt(settings.get("auto_renew_retry_days")) * 86400000L)
                : null;
            billingDao.upsertAttempt(toLong(member.get("id")), cycle,
                toDecimal(member.get("membership_fee")), null, "failed", attemptCount, nextRetry, error, null);
            Map<String, Object> dunning = sendDunning(member, settings,
                toDecimal(member.get("membership_fee")), error, attemptCount, maxAttempts);

            boolean paused = false;
            if (attemptCount >= maxAttempts) {
                billingDao.pauseClient(toLong(member.get("id")));
                paused = true;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", "failed");
            out.put("attempt_count", attemptCount);
            out.put("paused", paused);
            out.put("dunning_sent", dunning != null);
            return out;
        }

        // Charge succeeds (dev simulation of the gateway).
        String method = String.valueOf(member.get("recurring_method"));
        BigDecimal fee = toDecimal(member.get("membership_fee"));
        String newExpiry = Dates.nextExpiry(str(member, "membership_expiry"), str(member, "membership_type"));
        Map<String, Object> updated = billingDao.renewClient(toLong(member.get("id")), newExpiry, fee, method);
        paymentDao.insert(toLong(member.get("id")), fee, Dates.todayStr(), method, "Auto-renewal",
            PaymentContext.membership(str(member, "membership_type"),
                Dates.periodStart(str(member, "membership_expiry")), newExpiry));
        billingDao.upsertAttempt(toLong(member.get("id")), cycle, fee, method, "success", attemptCount,
            null, null, new Timestamp(System.currentTimeMillis()));

        String receipt = null;
        if (fee.signum() > 0) {
            ReminderService.NotifyDelivery r = reminderService.sendRenewalReceipt(
                updated, fee.toPlainString(), method, newExpiry);
            if (r != null) receipt = r.delivered();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", "renewed");
        out.put("new_expiry", newExpiry);
        out.put("receipt", receipt);
        out.put("attempt_count", attemptCount);
        return out;
    }

    private Map<String, Object> sendDunning(Map<String, Object> member, Map<String, Object> settings,
                                            BigDecimal amount, String error, int attemptCount, int maxAttempts) {
        String message = String.valueOf(settings.get("auto_renew_dunning_message"))
            .replace("{name}", str(member, "name") == null ? "" : str(member, "name"))
            .replace("{id}", str(member, "member_code") == null ? "" : str(member, "member_code"))
            .replace("{amount}", amount == null ? "—" : amount.setScale(2).toPlainString())
            .replace("{error}", error == null ? "" : error)
            .replace("{attempts}", String.valueOf(attemptCount))
            .replace("{max_attempts}", String.valueOf(maxAttempts));

        List<String> results = new ArrayList<>();
        List<String> recipients = new ArrayList<>();
        if (member.get("email") != null) {
            NotifyService.Delivery d = notifyService.sendNotificationEmail(
                String.valueOf(member.get("email")),
                "Action needed: auto-renewal for " + member.get("name"), message);
            results.add(d.delivered());
            recipients.add(d.recipient());
        }
        if (member.get("phone") != null) {
            NotifyService.Delivery d = notifyService.sendWhatsApp(String.valueOf(member.get("phone")), message);
            results.add(d.delivered());
            recipients.add(d.recipient());
        }
        if (results.isEmpty()) return null;

        String status = results.contains("failed") ? "failed"
            : results.stream().allMatch("console"::equals) ? "console" : "sent";
        notificationDao.logSend(toLong(member.get("id")), "dunning", str(member, "membership_expiry"),
            "email+whatsapp", String.join(", ", recipients), message, status);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("results", results);
        out.put("recipients", recipients);
        out.put("message", message);
        return out;
    }

    // ---- hourly job ---------------------------------------------------------------

    @Override
    public Map<String, Object> runAutoRenewCheck() {
        Map<String, Object> settings = getSettings();
        if (!Boolean.TRUE.equals(settings.get("auto_renew_enabled"))) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("enabled", false);
            r.put("due", 0);
            r.put("renewed", 0);
            r.put("failed", 0);
            return r;
        }
        List<Map<String, Object>> members = billingDao.findDueMembers(toInt(settings.get("auto_renew_days_before")));
        int renewed = 0;
        int failed = 0;
        for (Map<String, Object> member : members) {
            String status = String.valueOf(attemptCycle(member, false).get("status"));
            if ("renewed".equals(status)) renewed++;
            else if ("failed".equals(status)) failed++;
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", true);
        r.put("due", members.size());
        r.put("renewed", renewed);
        r.put("failed", failed);
        return r;
    }

    // ---- staff actions --------------------------------------------------------------

    @Override
    public Map<String, Object> retryMember(Long memberId) {
        Map<String, Object> member = billingDao.findClientById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        return attemptCycle(member, true);
    }

    @Override
    public Map<String, Object> markPaid(Long memberId, String amount, String method) {
        Map<String, Object> member = billingDao.findClientById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        BigDecimal fee = amount != null && !amount.isBlank()
            ? toDecimalOrNull(amount)
            : toDecimal(member.get("membership_fee"));
        if (fee == null || fee.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount must be a non-negative number");
        }
        String mode = method != null ? method
            : str(member, "recurring_method") != null ? str(member, "recurring_method") : "Cash";
        if (!PaymentModes.isValid(mode)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        String newExpiry = Dates.nextExpiry(str(member, "membership_expiry"), str(member, "membership_type"));
        Map<String, Object> updated = billingDao.renewClient(memberId, newExpiry, fee, mode);
        paymentDao.insert(memberId, fee, Dates.todayStr(), mode, "Auto-renewal (manual collection)",
            PaymentContext.membership(str(member, "membership_type"),
                Dates.periodStart(str(member, "membership_expiry")), newExpiry));
        billingDao.upsertAttempt(memberId, str(member, "membership_expiry"), fee, mode, "success", 1,
            null, null, new Timestamp(System.currentTimeMillis()));

        String receipt = null;
        if (fee.signum() > 0) {
            ReminderService.NotifyDelivery r = reminderService.sendRenewalReceipt(
                updated, fee.toPlainString(), mode, newExpiry);
            if (r != null) receipt = r.delivered();
        }
        BigDecimal due = toDecimal(updated.get("membership_fee")).subtract(fee).max(BigDecimal.ZERO);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("member", updated);
        out.put("new_expiry", newExpiry);
        out.put("amount_due", due);
        out.put("receipt", receipt);
        return out;
    }

    @Override
    public Map<String, Object> pauseMember(Long memberId) {
        Map<String, Object> member = billingDao.findClientById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        billingDao.pauseClient(memberId);
        billingDao.cancelPendingRetries(memberId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Auto-renew paused for " + member.get("name") + ".");
        return out;
    }

    @Override
    public Map<String, Object> setMemberBilling(Long memberId, Map<String, Object> body) {
        Map<String, Object> member = billingDao.findClientById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        Boolean autoRenew = body.containsKey("auto_renew") ? "true".equals(String.valueOf(body.get("auto_renew"))) : null;
        if (Boolean.TRUE.equals(autoRenew) && !"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot enable auto-renew for " + member.get("name") + " — the member is inactive.");
        }
        String recurringMethod = body.containsKey("recurring_method") ? str(body, "recurring_method") : null;
        if (recurringMethod != null && !recurringMethod.isEmpty() && recurringMethod.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "recurring_method cannot be blank");
        }
        return billingDao.updateMemberBilling(memberId, autoRenew, recurringMethod);
    }

    @Override
    public Map<String, Object> getOverview() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("settings", getSettings());
        out.put("members", billingDao.billingMembers());
        out.put("retries", billingDao.pendingRetries());
        out.put("dunning", billingDao.dunningLog());
        out.put("stats", billingDao.billingStats());
        return out;
    }

    // ---- helpers ----------------------------------------------------------------------

    private static int clamp(String raw, int def, int min, int max) {
        int n = toInt(raw == null ? def : raw);
        return n >= min && n <= max ? n : def;
    }

    private static int toInt(Object v) {
        try {
            return v instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static Long toLong(Object v) {
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
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

    private static BigDecimal toDecimalOrNull(String v) {
        try {
            return new BigDecimal(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
