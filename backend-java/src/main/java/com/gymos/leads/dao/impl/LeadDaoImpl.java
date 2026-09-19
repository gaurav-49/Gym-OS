package com.gymos.leads.dao.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.leads.dao.LeadDao;

@Repository
public class LeadDaoImpl implements LeadDao {

    private final JdbcTemplate jdbc;

    public LeadDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String LEAD_SELECT = """
        SELECT l.*, u.name AS captured_by, c.name AS converted_member_name
        FROM leads l
        LEFT JOIN users u ON u.id = l.created_by
        LEFT JOIN clients c ON c.id = l.converted_member_id""";

    @Override
    public List<Map<String, Object>> findLeads(String status, String source, String search) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (status != null && !status.isBlank()) {
            values.add(status);
            where.add("l.status = ?");
        }
        if (source != null && !source.isBlank()) {
            values.add(source);
            where.add("l.source = ?");
        }
        if (search != null && !search.isBlank()) {
            values.add("%" + search.toLowerCase() + "%");
            where.add("(LOWER(l.name) LIKE ? OR LOWER(COALESCE(l.phone, '')) LIKE ?"
                + " OR LOWER(COALESCE(l.email, '')) LIKE ?)");
            values.add("%" + search.toLowerCase() + "%");
            values.add("%" + search.toLowerCase() + "%");
        }
        String sql = LEAD_SELECT
            + (where.isEmpty() ? "" : " WHERE " + String.join(" AND ", where))
            + "\nORDER BY\n    CASE l.status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1\n"
            + "        WHEN 'visited' THEN 2 WHEN 'converted' THEN 3 ELSE 4 END,\n"
            + "    l.created_at DESC";
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Map<String, Object> insert(String name, String phone, String email, String interest,
                                      String source, String notes, Long createdBy) {
        return jdbc.queryForMap("""
            INSERT INTO leads (name, phone, email, interest, source, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            name, phone, email, interest, source, notes, createdBy);
    }

    /**
     * Name, phone and email are editable on the form and validated by the service,
     * but were missing from this statement — so correcting a mistyped phone number
     * returned HTTP 200 and changed nothing. A lead the gym cannot call is the one
     * thing a leads list must not contain.
     */
    @Override
    public Map<String, Object> update(Long id, String name, String phone, String email,
                                      String status, String notes, String interest, String source) {
        return jdbc.queryForMap("""
            UPDATE leads SET
                name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                status = COALESCE(?, status),
                notes = COALESCE(?, notes),
                interest = COALESCE(?, interest),
                source = COALESCE(?, source)
            WHERE id = ? RETURNING *""",
            name, phone, email, status, notes, interest, source, id);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM leads WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM leads WHERE id = ?", id);
    }

    @Override
    public Long nextMemberCode() {
        return jdbc.queryForObject(
            "SELECT COALESCE(MAX(member_code::int), 0) + 1 AS next FROM clients WHERE member_code ~ '^[0-9]+$'",
            Long.class);
    }

    @Override
    public void markConverted(Long id, Long memberId) {
        jdbc.update("""
            UPDATE leads SET status = 'converted', converted_member_id = ?, converted_at = NOW()
            WHERE id = ?""", memberId, id);
    }
}
