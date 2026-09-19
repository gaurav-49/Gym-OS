package com.gymos.tasks.dao.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.tasks.dao.TaskDao;

@Repository
public class TaskDaoImpl implements TaskDao {

    private final JdbcTemplate jdbc;

    public TaskDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String TASK_SELECT = """
        SELECT t.*, c.name AS member_name, c.member_code, c.risk_band, c.phone AS member_phone,
               l.name AS lead_name, l.phone AS lead_phone,
               u.name AS assignee_name, cb.name AS created_by_name,
               (t.status = 'open' AND t.due_on IS NOT NULL AND t.due_on < CURRENT_DATE) AS is_overdue
        FROM tasks t
        LEFT JOIN clients c ON c.id = t.member_id
        LEFT JOIN leads l ON l.id = t.lead_id
        LEFT JOIN users u ON u.id = t.assigned_to
        LEFT JOIN users cb ON cb.id = t.created_by""";

    @Override
    public List<Map<String, Object>> findTasks(String status, String category, Long assignedTo,
                                               Long memberId, String due, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(status)) {
            values.add(status);
            where.add("t.status = ?");
        }
        if (isSet(category)) {
            values.add(category);
            where.add("t.category = ?");
        }
        if (assignedTo != null) {
            values.add(assignedTo);
            where.add("t.assigned_to = ?");
        }
        if (memberId != null) {
            values.add(memberId);
            where.add("t.member_id = ?");
        }
        if ("overdue".equals(due)) {
            where.add("t.status = 'open' AND t.due_on < CURRENT_DATE");
        } else if ("today".equals(due)) {
            where.add("t.status = 'open' AND t.due_on = CURRENT_DATE");
        } else if ("week".equals(due)) {
            where.add("t.status = 'open' AND t.due_on <= CURRENT_DATE + 7");
        }
        values.add(limit);
        // Open first, then most urgent, then soonest due — the order the desk
        // actually works through the list.
        String sql = TASK_SELECT
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY (t.status = 'open') DESC,"
            + "\n         CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,"
            + "\n         t.due_on NULLS LAST, t.id DESC"
            + "\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    private static boolean isSet(String v) {
        return v != null && !v.isBlank();
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList(TASK_SELECT + "\nWHERE t.id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String title, String details, String category, String priority,
                                      String dueOn, Long memberId, Long leadId, Long assignedTo,
                                      Long createdBy) {
        return jdbc.queryForMap("""
            INSERT INTO tasks (title, details, category, priority, due_on, member_id, lead_id,
                               assigned_to, created_by)
            VALUES (?, ?, ?, ?, ?::date, ?, ?, ?, ?) RETURNING *""",
            title, details, category, priority, dueOn, memberId, leadId, assignedTo, createdBy);
    }

    @Override
    public Optional<Map<String, Object>> update(Long id, String title, String details, String category,
                                                String priority, String status, String dueOn,
                                                Long assignedTo, boolean completing) {
        return jdbc.queryForList("""
            UPDATE tasks SET
                title = COALESCE(?, title),
                details = COALESCE(?, details),
                category = COALESCE(?, category),
                priority = COALESCE(?, priority),
                status = COALESCE(?, status),
                due_on = COALESCE(?::date, due_on),
                assigned_to = COALESCE(?, assigned_to),
                completed_at = CASE WHEN ? THEN NOW() ELSE completed_at END
            WHERE id = ? RETURNING *""",
            title, details, category, priority, status, dueOn, assignedTo, completing, id)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> delete(Long id) {
        return jdbc.queryForList("DELETE FROM tasks WHERE id = ? RETURNING *", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> counts(Long assignedTo) {
        String scope = assignedTo == null ? "" : " AND assigned_to = ?";
        String sql = "SELECT"
            + " COUNT(*) FILTER (WHERE status = 'open')::int AS open,"
            + " COUNT(*) FILTER (WHERE status = 'open' AND due_on < CURRENT_DATE)::int AS overdue,"
            + " COUNT(*) FILTER (WHERE status = 'open' AND due_on = CURRENT_DATE)::int AS due_today,"
            + " COUNT(*) FILTER (WHERE status = 'done' AND completed_at >= CURRENT_DATE)::int AS done_today"
            + " FROM tasks WHERE 1 = 1" + scope;
        return assignedTo == null ? jdbc.queryForMap(sql) : jdbc.queryForMap(sql, assignedTo);
    }
}
