package com.gymos.tasks.service.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.tasks.dao.TaskDao;
import com.gymos.tasks.service.TaskService;

@Service
public class TaskServiceImpl implements TaskService {

    private static final List<String> CATEGORIES =
        List.of("follow-up", "retention", "payment", "lead", "maintenance", "admin", "other");
    private static final List<String> PRIORITIES = List.of("low", "normal", "high");
    private static final List<String> STATUSES = List.of("open", "done", "cancelled");

    private static final int MAX_TITLE = 150;
    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    private final TaskDao taskDao;
    private final AuditService audit;

    public TaskServiceImpl(TaskDao taskDao, AuditService audit) {
        this.taskDao = taskDao;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(String status, String category, Long assignedTo,
                                          Long memberId, String due, String limit) {
        if (status != null && !status.isBlank() && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
        return taskDao.findTasks(status, category, assignedTo, memberId, due, clamp(limit));
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long createdBy) {
        String title = Body.str(body, "title");
        if (title == null || title.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Task title is required");
        }
        if (title.trim().length() > MAX_TITLE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Task title must be " + MAX_TITLE + " characters or fewer");
        }
        String category = Body.str(body, "category");
        requireOneOf("category", category, CATEGORIES, true);
        String priority = Body.str(body, "priority");
        requireOneOf("priority", priority, PRIORITIES, true);
        String dueOn = Body.str(body, "due_on");
        requireDate("due_on", dueOn);

        Map<String, Object> task = taskDao.insert(title.trim(), Body.str(body, "details"),
            blankOr(category, "follow-up"), blankOr(priority, "normal"), blankToNull(dueOn),
            Body.toLong(body.get("member_id")), Body.toLong(body.get("lead_id")),
            Body.toLong(body.get("assigned_to")), createdBy);
        audit.record("create", "tasks", task.get("id"), "Created task \"" + task.get("title") + "\"");
        return task;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String title = body.containsKey("title") ? Body.str(body, "title") : null;
        if (body.containsKey("title") && (title == null || title.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Task title is required");
        }
        String category = body.containsKey("category") ? Body.str(body, "category") : null;
        requireOneOf("category", category, CATEGORIES, false);
        String priority = body.containsKey("priority") ? Body.str(body, "priority") : null;
        requireOneOf("priority", priority, PRIORITIES, false);
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        requireOneOf("status", status, STATUSES, false);
        String dueOn = Body.str(body, "due_on");
        requireDate("due_on", dueOn);

        Map<String, Object> existing = taskDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Task not found"));

        // completed_at is stamped only on the transition into 'done', so
        // re-saving a done task does not keep moving its completion time.
        boolean completing = "done".equals(status) && !"done".equals(String.valueOf(existing.get("status")));

        Map<String, Object> updated = taskDao.update(id,
            title == null ? null : title.trim(), body.containsKey("details") ? Body.str(body, "details") : null,
            category, priority, status, blankToNull(dueOn),
            Body.toLong(body.get("assigned_to")), completing)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Task not found"));

        audit.record(completing ? "complete" : "update", "tasks", id,
            "Task \"" + updated.get("title") + "\" → " + updated.get("status"));
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> task = taskDao.delete(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Task not found"));
        audit.record("delete", "tasks", id, "Deleted task \"" + task.get("title") + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Task removed.");
        out.put("task", task);
        return out;
    }

    @Override
    public Map<String, Object> counts(Long assignedTo) {
        return taskDao.counts(assignedTo);
    }

    // ---- helpers -------------------------------------------------------------

    private static void requireOneOf(String field, String value, List<String> allowed, boolean allowBlank) {
        if (value == null || (allowBlank && value.isBlank())) {
            return;
        }
        if (!allowed.contains(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be one of: " + String.join(", ", allowed));
        }
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static String blankOr(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v;
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    private static int clamp(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_LIMIT;
        }
        try {
            return Math.min(MAX_LIMIT, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_LIMIT;
        }
    }
}
