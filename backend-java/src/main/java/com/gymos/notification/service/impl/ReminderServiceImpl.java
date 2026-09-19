package com.gymos.notification.service.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.branding.service.BrandingService;
import com.gymos.member.dao.ClientDao;
import com.gymos.notification.dao.NotificationDao;
import com.gymos.notification.service.ReminderService;
import com.gymos.notify.service.NotifyService;

import org.springframework.http.HttpStatus;

/**
 * Reminder service — expiry reminders + renewal receipts, mirroring the Node
 * reminderService.js messages, settings and dedupe behaviour.
 */
@Service
public class ReminderServiceImpl implements ReminderService {

    private static final Map<String, String> DEFAULTS = Map.ofEntries(
        Map.entry("expiry_reminder_enabled", "true"),
        Map.entry("expiry_reminder_days", "7"),
        Map.entry("expiry_reminder_channel", "both"),
        Map.entry("expiry_reminder_message",
            // {gym} is substituted with the branding name, so the shipped
            // default is not a vendor signature on a white-labelled install.
            "Hi {name}, your {gym} membership (ID {id}) will expire on {expiry}."
                + " Please renew to continue your workouts. — {gym}"),
        Map.entry("renewal_receipt_enabled", "true"));

    private static final List<String> VALID_CHANNELS = List.of("email", "whatsapp", "both");

    private final NotificationDao dao;
    private final NotifyService notifyService;
    private final ClientDao clientDao;
    private final BrandingService branding;

    public ReminderServiceImpl(NotificationDao dao, NotifyService notifyService, ClientDao clientDao,
                               BrandingService branding) {
        this.dao = dao;
        this.notifyService = notifyService;
        this.clientDao = clientDao;
        this.branding = branding;
    }

    /**
     * The gym's own name for anything a member reads.
     *
     * <p>These messages go out over the gym's name, not the vendor's. A
     * white-labelled install that still signs its renewal receipts "— GYM OS"
     * has told every one of its members who really runs the software.
     */
    private String gymName() {
        try {
            Object name = branding.get().get("name");
            return name == null || String.valueOf(name).isBlank() ? "your gym" : String.valueOf(name);
        } catch (RuntimeException e) {
            // A reminder must still go out if the settings table is unreachable.
            return "your gym";
        }
    }

    /**
     * The gym's own line, if it has set one. It signs the receipt underneath
     * the gym's name — the same slogan the sign-in screen and the printed
     * receipt carry, so the three do not each speak with a different voice.
     */
    private String gymQuote() {
        try {
            Object quote = branding.get().get("quote");
            return quote == null ? "" : String.valueOf(quote).trim();
        } catch (RuntimeException e) {
            return "";
        }
    }

    @Override
    public Map<String, Object> getSettings() {
        Map<String, String> map = dao.getSettings();
        int days = parseInt(map.getOrDefault("expiry_reminder_days", DEFAULTS.get("expiry_reminder_days")));
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("expiry_reminder_enabled",
            !"false".equals(map.getOrDefault("expiry_reminder_enabled", DEFAULTS.get("expiry_reminder_enabled"))));
        s.put("expiry_reminder_days", days >= 1 ? days : 7);
        String channel = map.get("expiry_reminder_channel");
        s.put("expiry_reminder_channel", channel != null && VALID_CHANNELS.contains(channel) ? channel : "both");
        s.put("expiry_reminder_message",
            (map.getOrDefault("expiry_reminder_message", DEFAULTS.get("expiry_reminder_message"))).trim());
        s.put("renewal_receipt_enabled",
            !"false".equals(map.getOrDefault("renewal_receipt_enabled", DEFAULTS.get("renewal_receipt_enabled"))));
        return s;
    }

    @Override
    public Map<String, Object> saveSettings(Map<String, Object> input) {
        Map<String, Object> next = new LinkedHashMap<>(getSettings());
        if (input != null) next.putAll(input);

        if (input != null && input.containsKey("expiry_reminder_days")) {
            int days = toInt(input.get("expiry_reminder_days"));
            if (days < 1 || days > 365) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "expiry_reminder_days must be between 1 and 365");
            }
            next.put("expiry_reminder_days", days);
        }
        if (input != null && input.containsKey("expiry_reminder_channel")) {
            String channel = String.valueOf(input.get("expiry_reminder_channel"));
            if (!VALID_CHANNELS.contains(channel)) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "expiry_reminder_channel must be email, whatsapp or both");
            }
            next.put("expiry_reminder_channel", channel);
        }
        if (input != null && input.containsKey("expiry_reminder_message")) {
            String msg = String.valueOf(input.get("expiry_reminder_message")).trim();
            if (msg.isEmpty()) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "expiry_reminder_message cannot be empty");
            }
            next.put("expiry_reminder_message", msg);
        }
        if (input != null && input.containsKey("expiry_reminder_enabled")) {
            next.put("expiry_reminder_enabled", "true".equals(String.valueOf(input.get("expiry_reminder_enabled"))));
        }
        if (input != null && input.containsKey("renewal_receipt_enabled")) {
            next.put("renewal_receipt_enabled", "true".equals(String.valueOf(input.get("renewal_receipt_enabled"))));
        }

        dao.upsertSetting("expiry_reminder_enabled", String.valueOf(next.get("expiry_reminder_enabled")));
        dao.upsertSetting("expiry_reminder_days", String.valueOf(next.get("expiry_reminder_days")));
        dao.upsertSetting("expiry_reminder_channel", String.valueOf(next.get("expiry_reminder_channel")));
        dao.upsertSetting("expiry_reminder_message", String.valueOf(next.get("expiry_reminder_message")));
        dao.upsertSetting("renewal_receipt_enabled", String.valueOf(next.get("renewal_receipt_enabled")));
        return next;
    }

    @Override
    public List<Map<String, Object>> getExpiringMembers(int days) {
        return dao.expiringMembers(days);
    }

    @Override
    public boolean hasSent(Long memberId, String kind, String cycle) {
        return dao.hasSent(memberId, kind, cycle);
    }

    @Override
    public Map<String, Object> sendReminderTo(Map<String, Object> member, Map<String, Object> settings) {
        String message = fillTemplate(String.valueOf(settings.get("expiry_reminder_message")),
            str(member, "name"), str(member, "member_code"), str(member, "membership_expiry"));
        String channel = String.valueOf(settings.get("expiry_reminder_channel"));
        List<String> results = new ArrayList<>();
        List<String> recipients = new ArrayList<>();
        boolean wantEmail = "both".equals(channel) || "email".equals(channel);
        boolean wantWhatsapp = "both".equals(channel) || "whatsapp".equals(channel);

        if (wantEmail && member.get("email") != null) {
            NotifyService.Delivery d = notifyService.sendNotificationEmail(
                String.valueOf(member.get("email")), "Membership expiring soon — renew now", message);
            results.add(d.delivered());
            recipients.add(d.recipient());
        }
        if (wantWhatsapp && member.get("phone") != null) {
            NotifyService.Delivery d = notifyService.sendWhatsApp(String.valueOf(member.get("phone")), message);
            results.add(d.delivered());
            recipients.add(d.recipient());
        }
        if (results.isEmpty()) {
            return null; // no contact for the chosen channel
        }
        dao.logSend(toLong(member.get("id")), "expiry_reminder", str(member, "membership_expiry"),
            channel, String.join(", ", recipients), message, deliveryStatus(results));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("results", results);
        out.put("recipients", recipients);
        out.put("message", message);
        return out;
    }

    @Override
    public Map<String, Object> runExpiryReminderCheck() {
        Map<String, Object> settings = getSettings();
        if (!Boolean.TRUE.equals(settings.get("expiry_reminder_enabled"))) {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("enabled", false);
            r.put("members", 0);
            r.put("sent", 0);
            return r;
        }
        List<Map<String, Object>> members = getExpiringMembers((Integer) settings.get("expiry_reminder_days"));
        int sent = 0;
        for (Map<String, Object> member : members) {
            String cycle = str(member, "membership_expiry");
            if (dao.hasSent(toLong(member.get("id")), "expiry_reminder", cycle)) continue;
            if (sendReminderTo(member, settings) != null) sent++;
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("enabled", true);
        r.put("members", members.size());
        r.put("sent", sent);
        return r;
    }

    @Override
    public Map<String, Object> getExpiring(int days) {
        if (days < 1) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "days must be a positive number");
        }
        List<Map<String, Object>> members = getExpiringMembers(days);
        List<Map<String, Object>> enriched = new ArrayList<>();
        for (Map<String, Object> m : members) {
            Map<String, Object> row = new LinkedHashMap<>(m);
            row.put("reminder_sent", dao.hasSent(toLong(m.get("id")), "expiry_reminder",
                str(m, "membership_expiry")));
            row.put("channels_available", Map.of(
                "email", m.get("email") != null,
                "whatsapp", m.get("phone") != null));
            enriched.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("days", days);
        out.put("members", enriched);
        return out;
    }

    @Override
    public Map<String, Object> sendManualReminder(Long memberId) {
        Map<String, Object> member = clientDao.findById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        Map<String, Object> settings = getSettings();
        Map<String, Object> result = sendReminderTo(member, settings);
        if (result == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "No " + settings.get("expiry_reminder_channel") + " contact on file for "
                    + member.get("name") + ". Add an email/phone to the member first.");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Reminder sent to " + member.get("name")
            + " (" + String.join(", ", (List<String>) result.get("results")) + ").");
        out.put("member", member.get("name"));
        out.put("results", result.get("results"));
        out.put("recipients", result.get("recipients"));
        return out;
    }

    @Override
    public Map<String, Object> sendAllReminders() {
        Map<String, Object> settings = getSettings();
        int days = toInt(settings.get("expiry_reminder_days"));
        List<Map<String, Object>> members = getExpiringMembers(days);
        int sent = 0;
        int skipped = 0;
        for (Map<String, Object> member : members) {
            if (dao.hasSent(toLong(member.get("id")), "expiry_reminder", str(member, "membership_expiry"))) {
                skipped++;
                continue;
            }
            if (sendReminderTo(member, settings) != null) sent++;
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Reminders sent to " + sent + " member(s).");
        out.put("sent", sent);
        out.put("skipped", skipped);
        out.put("total", members.size());
        return out;
    }

    @Override
    public NotifyDelivery sendRenewalReceipt(Map<String, Object> member, String amount, String method, String newExpiry) {
        Map<String, Object> settings = getSettings();
        if (!Boolean.TRUE.equals(settings.get("renewal_receipt_enabled"))) return null;
        if (member.get("email") == null) return null;
        if (dao.hasSent(toLong(member.get("id")), "renewal_receipt", newExpiry)) return null;

        BigDecimal fee = toDecimal(member.get("membership_fee"));
        BigDecimal paid = toDecimal(member.get("amount_paid"));
        BigDecimal due = fee.subtract(paid).max(BigDecimal.ZERO);
        StringBuilder lines = new StringBuilder();
        lines.append("Dear ").append(str(member, "name")).append(",\n\n");
        lines.append("Thank you for renewing your ").append(gymName()).append(" membership.\n");
        lines.append("Member ID: ").append(str(member, "member_code")).append("\n");
        lines.append("Membership: ").append(str(member, "membership_type") == null ? "—" : str(member, "membership_type")).append("\n");
        lines.append("Valid until: ").append(newExpiry).append("\n");
        if (amount != null && toDecimal(amount).signum() > 0) {
            lines.append("Amount received: ₹").append(toDecimal(amount).toPlainString())
                .append(method == null ? "" : " (" + method + ")").append("\n");
        }
        if (due.signum() > 0) {
            lines.append("Amount due: ₹").append(due.toPlainString()).append("\n");
            // There is no instalment plan in this product, and the doors read
            // the same balance — better the member hears it here than at the
            // turnstile.
            lines.append("Entry by QR, fingerprint or card stays locked until this is cleared.\n");
        }
        lines.append("\n— ").append(gymName());
        String quote = gymQuote();
        if (!quote.isEmpty()) {
            lines.append("\n").append(quote);
        }

        NotifyService.Delivery d = notifyService.sendNotificationEmail(
            String.valueOf(member.get("email")), "Membership Renewal Receipt", lines.toString());
        dao.logSend(toLong(member.get("id")), "renewal_receipt", newExpiry, "email",
            String.valueOf(member.get("email")), lines.toString(), d.delivered());
        return new NotifyDelivery(d.delivered(), d.recipient());
    }

    private String fillTemplate(String template, String name, String id, String expiry) {
        return template
            .replace("{name}", name == null ? "" : name)
            .replace("{id}", id == null ? "" : id)
            .replace("{expiry}", expiry == null ? "" : expiry)
            // A gym that has customised its own message may not use {gym} at
            // all — replace() on an absent token is simply a no-op.
            .replace("{gym}", gymName());
    }

    private static String deliveryStatus(List<String> results) {
        if (results.contains("failed")) return "failed";
        return results.stream().allMatch("console"::equals) ? "console" : "sent";
    }

    static int parseInt(String v) {
        try {
            return Integer.parseInt(v);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    static int toInt(Object v) {
        try {
            return v instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    static Long toLong(Object v) {
        if (v == null) return null;
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }

    static BigDecimal toDecimal(Object v) {
        if (v == null) return BigDecimal.ZERO;
        return v instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(v));
    }

    static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
