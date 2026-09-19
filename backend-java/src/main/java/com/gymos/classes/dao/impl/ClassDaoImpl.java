package com.gymos.classes.dao.impl;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.classes.dao.ClassDao;

@Repository
public class ClassDaoImpl implements ClassDao {

    private final JdbcTemplate jdbc;

    public ClassDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String CLASS_SELECT = """
        SELECT c.*, u.name AS trainer_name
        FROM gym_classes c
        LEFT JOIN users u ON u.id = c.trainer_id""";

    @Override
    public List<Map<String, Object>> findTrainers() {
        return jdbc.queryForList(
            "SELECT id, name, username FROM users WHERE role IN ('admin', 'trainer') ORDER BY name");
    }

    @Override
    public List<Map<String, Object>> findClasses(boolean includePast) {
        String sql = CLASS_SELECT + "\nWHERE c.status = 'active'"
            + (includePast ? "" : "\nAND c.class_date >= CURRENT_DATE")
            + "\nORDER BY c.class_date, c.start_time";
        return jdbc.queryForList(sql);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList(CLASS_SELECT + "\nWHERE c.id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<String> findStatusById(Long id) {
        return jdbc.queryForList("SELECT status FROM gym_classes WHERE id = ?", id).stream()
            .map(r -> String.valueOf(r.get("status"))).findFirst();
    }

    @Override
    public Map<String, Object> counts(Long classId) {
        return jdbc.queryForMap("""
            SELECT
                COUNT(*) FILTER (WHERE status = 'booked')::int AS booked,
                COUNT(*) FILTER (WHERE status = 'waitlisted')::int AS waitlisted
            FROM class_bookings WHERE class_id = ?""", classId);
    }

    @Override
    public Optional<Map<String, Object>> myStatus(Long classId, Long memberId) {
        return jdbc.queryForList(
            "SELECT status FROM class_bookings WHERE class_id = ? AND member_id = ? AND status <> 'cancelled'",
            classId, memberId).stream().findFirst();
    }

    @Override
    public Map<String, Object> insertClass(String name, String description, Long trainerId, String classDate,
                                           String startTime, String endTime, Integer capacity) {
        return jdbc.queryForMap("""
            INSERT INTO gym_classes (name, description, trainer_id, class_date, start_time, end_time, capacity)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            name, description, trainerId, classDate, startTime, endTime, capacity);
    }

    @Override
    public void insertClassBatch(String name, String description, Long trainerId, String classDate,
                                 String startTime, String endTime, Integer capacity) {
        jdbc.update("""
            INSERT INTO gym_classes (name, description, trainer_id, class_date, start_time, end_time, capacity)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            name, description, trainerId, classDate, startTime, endTime, capacity);
    }

    @Override
    public Map<String, Object> updateClass(Long id, String name, String description, Long trainerId, String classDate,
                                           String startTime, String endTime, Integer capacity, String status) {
        return jdbc.queryForMap("""
            UPDATE gym_classes SET
                name = COALESCE(?, name),
                description = COALESCE(?, description),
                trainer_id = COALESCE(?, trainer_id),
                class_date = COALESCE(?, class_date),
                start_time = COALESCE(?, start_time),
                end_time = COALESCE(?, end_time),
                capacity = COALESCE(?, capacity),
                status = COALESCE(?, status)
            WHERE id = ? RETURNING *""",
            name, description, trainerId, classDate, startTime, endTime, capacity, status, id);
    }

    @Override
    public int cancelClass(Long id) {
        return jdbc.update(
            "UPDATE gym_classes SET status = 'cancelled' WHERE id = ? AND status = 'active'", id);
    }

    @Override
    public List<Map<String, Object>> findBookings(Long classId) {
        return jdbc.queryForList("""
            SELECT b.id, b.member_id, b.status, b.created_at, c.member_code, c.name AS member_name, c.phone
            FROM class_bookings b
            JOIN clients c ON c.id = b.member_id
            WHERE b.class_id = ? AND b.status <> 'cancelled'
            ORDER BY CASE b.status WHEN 'booked' THEN 0 ELSE 1 END, b.created_at, b.id""", classId);
    }

    @Override
    public Optional<Map<String, Object>> findActiveBooking(Long classId, Long memberId) {
        return jdbc.queryForList(
            "SELECT id, status FROM class_bookings"
                + " WHERE class_id = ? AND member_id = ? AND status <> 'cancelled'",
            classId, memberId).stream().findFirst();
    }

    @Override
    public void upsertBooking(Long classId, Long memberId, String status) {
        jdbc.update("""
            INSERT INTO class_bookings (class_id, member_id, status) VALUES (?, ?, ?)
            ON CONFLICT (class_id, member_id)
            DO UPDATE SET status = EXCLUDED.status, created_at = NOW()""", classId, memberId, status);
    }

    @Override
    public int cancelBooking(Long classId, Long memberId) {
        return jdbc.update("""
            UPDATE class_bookings SET status = 'cancelled'
            WHERE class_id = ? AND member_id = ? AND status IN ('booked', 'waitlisted')""",
            classId, memberId);
    }

    @Override
    public Optional<Map<String, Object>> firstWaitlisted(Long classId) {
        return jdbc.queryForList("""
            SELECT id FROM class_bookings
            WHERE class_id = ? AND status = 'waitlisted' ORDER BY created_at, id LIMIT 1""", classId)
            .stream().findFirst();
    }

    @Override
    public Optional<Long> promoteWaitlisted(Long bookingId) {
        return jdbc.queryForList(
            "UPDATE class_bookings SET status = 'booked'"
                + " WHERE id = ? AND status = 'waitlisted' RETURNING member_id", bookingId).stream()
            .map(r -> ((Number) r.get("member_id")).longValue()).findFirst();
    }

    @Override
    public Optional<Integer> waitlistPosition(Long classId, Long memberId) {
        // Same ordering as firstWaitlisted, so the position a member is shown is
        // exactly the queue the promotion actually walks.
        return jdbc.queryForList("""
            SELECT position FROM (
                SELECT member_id,
                       ROW_NUMBER() OVER (ORDER BY created_at, id)::int AS position
                FROM class_bookings
                WHERE class_id = ? AND status = 'waitlisted'
            ) q WHERE member_id = ?""", classId, memberId)
            .stream().findFirst().map(row -> ((Number) row.get("position")).intValue());
    }

    @Override
    public Optional<Map<String, Object>> findMemberContact(Long memberId) {
        return jdbc.queryForList("SELECT id, name, phone, email FROM clients WHERE id = ?", memberId)
            .stream().findFirst();
    }

    @Override
    public Optional<String> findMemberName(Long memberId) {
        return jdbc.queryForList("SELECT name FROM clients WHERE id = ?", memberId).stream()
            .map(r -> String.valueOf(r.get("name"))).findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findMemberBookable(Long memberId) {
        return jdbc.queryForList(
            "SELECT member_code, name, status, membership_expiry, frozen_until FROM clients WHERE id = ?",
            memberId).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> memberClasses(Long memberId) {
        return jdbc.queryForList(CLASS_SELECT
            + "\nWHERE c.status = 'active' AND c.class_date >= CURRENT_DATE"
            + "\nORDER BY c.class_date, c.start_time");
    }

    @Override
    public List<Map<String, Object>> myBookings(Long memberId) {
        return jdbc.queryForList("""
            SELECT b.id AS booking_id, b.status AS booking_status, b.created_at,
                   c.id AS class_id, c.name, c.class_date, c.start_time, c.end_time,
                   u.name AS trainer_name
            FROM class_bookings b
            JOIN gym_classes c ON c.id = b.class_id
            LEFT JOIN users u ON u.id = c.trainer_id
            WHERE b.member_id = ? AND b.status <> 'cancelled' AND c.class_date >= CURRENT_DATE
            ORDER BY c.class_date, c.start_time""", memberId);
    }
}
