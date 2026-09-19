package com.gymos.notification.dao.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.notification.dao.NotificationDao;

@Repository
public class NotificationDaoImpl implements NotificationDao {

    private final JdbcTemplate jdbc;

    public NotificationDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Map<String, String> getSettings() {
        Map<String, String> map = new LinkedHashMap<>();
        for (Map<String, Object> row : jdbc.queryForList("SELECT key, value FROM settings")) {
            map.put(String.valueOf(row.get("key")), String.valueOf(row.get("value")));
        }
        return map;
    }

    @Override
    public void upsertSetting(String key, String value) {
        jdbc.update("""
            INSERT INTO settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""", key, value);
    }

    @Override
    public boolean hasSent(Long memberId, String kind, String cycle) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT id FROM notification_log WHERE member_id = ? AND kind = ? AND cycle = ? LIMIT 1",
            memberId, kind, cycle);
        return !rows.isEmpty();
    }

    @Override
    public void logSend(Long memberId, String kind, String cycle, String channel, String recipient,
                        String message, String status) {
        jdbc.update("""
            INSERT INTO notification_log (member_id, kind, cycle, channel, recipient, message, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)""", memberId, kind, cycle, channel, recipient, message, status);
    }

    @Override
    public List<Map<String, Object>> expiringMembers(int days) {
        return jdbc.queryForList("""
            SELECT id, member_code, name, email, phone, membership_expiry
            FROM clients
            WHERE status = 'active'
              AND membership_expiry IS NOT NULL
              AND membership_expiry >= CURRENT_DATE
              AND membership_expiry <= CURRENT_DATE + make_interval(days => ?)
            ORDER BY membership_expiry""", days);
    }

    @Override
    public List<Map<String, Object>> notificationLog() {
        return jdbc.queryForList("""
            SELECT l.*, c.name AS member_name
            FROM notification_log l
            LEFT JOIN clients c ON c.id = l.member_id
            ORDER BY l.id DESC LIMIT 100""");
    }
}
