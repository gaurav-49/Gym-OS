package com.gymos.notification.dao;

import java.util.List;
import java.util.Map;

/**
 * Notification data access — settings key/value table, notification_log and the
 * expiring-members query. All SQL lives in
 * {@link com.gymos.notification.dao.impl.NotificationDaoImpl}.
 */
public interface NotificationDao {

    Map<String, String> getSettings();

    void upsertSetting(String key, String value);

    boolean hasSent(Long memberId, String kind, String cycle);

    void logSend(Long memberId, String kind, String cycle, String channel, String recipient,
                 String message, String status);

    /** Active members whose membership expires within `days` (inclusive), ordered by expiry. */
    List<Map<String, Object>> expiringMembers(int days);

    List<Map<String, Object>> notificationLog();
}
