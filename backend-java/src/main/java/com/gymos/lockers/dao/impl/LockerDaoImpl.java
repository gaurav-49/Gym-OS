package com.gymos.lockers.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.lockers.dao.LockerDao;

@Repository
public class LockerDaoImpl implements LockerDao {

    private final JdbcTemplate jdbc;

    public LockerDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // is_overdue is computed here rather than in the UI so every caller — the
    // list, the dashboard and any report — agrees on what "overdue" means.
    private static final String LOCKER_SELECT = """
        SELECT l.*, c.name AS member_name, c.member_code,
               CASE WHEN l.assigned_until IS NOT NULL AND l.assigned_until < CURRENT_DATE
                    THEN TRUE ELSE FALSE END AS is_overdue
        FROM lockers l
        LEFT JOIN clients c ON c.id = l.member_id""";

    @Override
    public List<Map<String, Object>> findLockers(String status, String search) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (status != null && !status.isBlank()) {
            values.add(status);
            where.add("l.status = ?");
        }
        if (search != null && !search.isBlank()) {
            String like = "%" + search.toLowerCase() + "%";
            where.add("(LOWER(l.locker_number) LIKE ? OR LOWER(COALESCE(l.location, '')) LIKE ?"
                + " OR LOWER(COALESCE(c.name, '')) LIKE ? OR COALESCE(c.member_code, '') LIKE ?)");
            for (int i = 0; i < 4; i++) {
                values.add(like);
            }
        }
        // LENGTH() first so A2 sorts before A10 — plain text order would not.
        String sql = LOCKER_SELECT
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY l.status, LENGTH(l.locker_number), l.locker_number";
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM lockers WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByIdWithMember(Long id) {
        return jdbc.queryForList("""
            SELECT l.*, c.name AS member_name FROM lockers l
            LEFT JOIN clients c ON c.id = l.member_id WHERE l.id = ?""", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByNumber(String lockerNumber) {
        return jdbc.queryForList("SELECT id FROM lockers WHERE UPPER(locker_number) = ?", lockerNumber)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findHeldBy(Long memberId) {
        // The whole row, not just the number: the member's record shows the
        // locker's dates and rent, and it used to come back holding a number
        // with a blank "until" beside it.
        return jdbc.queryForList("""
            SELECT id, locker_number, location, size, monthly_rent, status,
                   assigned_from, assigned_until
            FROM lockers WHERE member_id = ? ORDER BY id LIMIT 1""", memberId)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String lockerNumber, String location, String size,
                                      BigDecimal monthlyRent, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO lockers (locker_number, location, size, monthly_rent, notes)
            VALUES (?, ?, ?, ?, ?) RETURNING *""",
            lockerNumber, location, size, monthlyRent, notes);
    }

    @Override
    public Map<String, Object> update(Long id, String location, String size, BigDecimal monthlyRent,
                                      String notes, String status) {
        return jdbc.queryForMap("""
            UPDATE lockers SET
                location = COALESCE(?, location),
                size = COALESCE(?, size),
                monthly_rent = COALESCE(?, monthly_rent),
                notes = COALESCE(?, notes),
                status = COALESCE(?, status)
            WHERE id = ? RETURNING *""",
            location, size, monthlyRent, notes, status, id);
    }

    @Override
    public Map<String, Object> assign(Long id, Long memberId, String from, String until) {
        return jdbc.queryForMap("""
            UPDATE lockers SET member_id = ?, status = 'occupied', assigned_from = ?, assigned_until = ?
            WHERE id = ? RETURNING *""", memberId, from, until, id);
    }

    @Override
    public Map<String, Object> release(Long id) {
        return jdbc.queryForMap("""
            UPDATE lockers SET member_id = NULL, status = 'free', assigned_from = NULL, assigned_until = NULL
            WHERE id = ? RETURNING *""", id);
    }

    @Override
    public void delete(Long id) {
        jdbc.update("DELETE FROM lockers WHERE id = ?", id);
    }
}
