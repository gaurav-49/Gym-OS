package com.gymos.attendance.dao.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.attendance.dao.AttendanceDao;

@Repository
public class AttendanceDaoImpl implements AttendanceDao {

    private final JdbcTemplate jdbc;

    public AttendanceDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findAll() {
        return jdbc.queryForList("SELECT * FROM attendance ORDER BY id DESC");
    }

    @Override
    public List<Map<String, Object>> report(String from, String to, String memberId, String status, String source) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (from != null) { values.add(from); where.add("a.date >= ?"); }
        if (to != null) { values.add(to); where.add("a.date <= ?"); }
        if (memberId != null) { values.add(memberId); where.add("a.member_id = ?"); }
        if (status != null) { values.add(status); where.add("a.status = ?"); }
        if (source != null) { values.add(source); where.add("a.source = ?"); }
        String sql = "SELECT a.*, c.name AS member_name_full\n"
            + "FROM attendance a\n"
            + "LEFT JOIN clients c ON c.member_code = a.member_id::text\n"
            + (where.isEmpty() ? "" : "WHERE " + String.join(" AND ", where))
            + "\nORDER BY a.date DESC, a.time DESC";
        return jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findByMemberAndDate(String memberId, String date) {
        return jdbc.queryForList(
            "SELECT * FROM attendance WHERE member_id = ? AND date = ?", memberId, date).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String memberId, String memberName, String date, String time,
                                      String status, String source) {
        return jdbc.queryForMap("""
            INSERT INTO attendance (member_id, member_name, date, time, status, source)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING *""", memberId, memberName, date, time, status, source);
    }
}
