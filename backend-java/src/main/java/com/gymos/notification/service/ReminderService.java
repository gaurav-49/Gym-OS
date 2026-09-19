package com.gymos.notification.service;

import java.util.List;
import java.util.Map;

/**
 * Expiry reminders + renewal receipts — port of the Node reminderService.
 * Settings live in the settings table; messages are deduped per member + kind +
 * expiry cycle in notification_log.
 */
public interface ReminderService {

    Map<String, Object> getSettings();

    Map<String, Object> saveSettings(Map<String, Object> input);

    List<Map<String, Object>> getExpiringMembers(int days);

    boolean hasSent(Long memberId, String kind, String cycle);

    /** Deliver one expiry reminder to one member; null if no contact for the channel. */
    Map<String, Object> sendReminderTo(Map<String, Object> member, Map<String, Object> settings);

    /** Auto job — send a reminder once per expiry cycle. */
    Map<String, Object> runExpiryReminderCheck();

    /** Expiring members enriched with reminder_sent + channels_available. */
    Map<String, Object> getExpiring(int days);

    /** Manual reminder for one member; throws 400 when no contact for the channel. */
    Map<String, Object> sendManualReminder(Long memberId);

    /** Send to every expiring member that hasn't been reminded yet this cycle. */
    Map<String, Object> sendAllReminders();

    /** Email the member a renewal receipt; null when disabled / no email / already sent. */
    NotifyDelivery sendRenewalReceipt(Map<String, Object> member, String amount, String method, String newExpiry);

    /** Delivery result of one message. */
    record NotifyDelivery(String delivered, String recipient) {
    }
}
