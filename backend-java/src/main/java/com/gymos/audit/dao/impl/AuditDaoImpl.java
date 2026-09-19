package com.gymos.audit.dao.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.audit.dao.AuditDao;

@Repository
public class AuditDaoImpl implements AuditDao {

    private final JdbcTemplate jdbc;

    public AuditDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> search(String module, String action, Long userId,
                                            String from, String to, String search, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(module)) {
            values.add(module);
            where.add("a.module = ?");
        }
        if (isSet(action)) {
            values.add(action);
            where.add("a.action = ?");
        }
        if (userId != null) {
            values.add(userId);
            where.add("a.user_id = ?");
        }
        if (isSet(from)) {
            values.add(from);
            where.add("a.created_at >= ?::date");
        }
        if (isSet(to)) {
            // Exclusive upper bound on the next day so "to" includes its whole day.
            values.add(to);
            where.add("a.created_at < (?::date + 1)");
        }
        if (isSet(search)) {
            String like = "%" + search.toLowerCase() + "%";
            values.add(like);
            values.add(like);
            where.add("(LOWER(COALESCE(a.summary, '')) LIKE ? OR LOWER(COALESCE(a.username, '')) LIKE ?)");
        }
        values.add(limit);

        String sql = """
            SELECT a.*, u.name AS user_full_name, u.role
            FROM audit_log a
            LEFT JOIN users u ON u.id = a.user_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY a.created_at DESC, a.id DESC\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    private static boolean isSet(String v) {
        return v != null && !v.isBlank();
    }

    @Override
    public List<Map<String, Object>> countsByModule() {
        return jdbc.queryForList("SELECT module, COUNT(*)::int AS n FROM audit_log GROUP BY 1 ORDER BY 2 DESC");
    }

    @Override
    public List<Map<String, Object>> countsByAction() {
        return jdbc.queryForList("SELECT action, COUNT(*)::int AS n FROM audit_log GROUP BY 1 ORDER BY 2 DESC");
    }

    @Override
    public List<Map<String, Object>> topActors() {
        return jdbc.queryForList("""
            SELECT a.user_id, COALESCE(u.name, a.username) AS name, COUNT(*)::int AS n
            FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
            WHERE a.user_id IS NOT NULL
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20""");
    }

    @Override
    public Map<String, Object> totals() {
        return jdbc.queryForMap("""
            SELECT
                (SELECT COUNT(*)::int FROM audit_log) AS total,
                (SELECT COUNT(*)::int FROM audit_log WHERE created_at >= CURRENT_DATE) AS today,
                (SELECT COUNT(*)::int FROM audit_log WHERE created_at >= CURRENT_DATE - 7) AS week""");
    }
}
