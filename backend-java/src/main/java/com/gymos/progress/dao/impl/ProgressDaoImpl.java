package com.gymos.progress.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.progress.dao.ProgressDao;

@Repository
public class ProgressDaoImpl implements ProgressDao {

    private final JdbcTemplate jdbc;

    public ProgressDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findByMember(Long memberId) {
        return jdbc.queryForList(
            "SELECT * FROM member_progress WHERE member_id = ? ORDER BY record_date DESC, id DESC", memberId);
    }

    @Override
    public Map<String, Object> insert(Long memberId, String recordDate, BigDecimal weight, BigDecimal bodyFat,
                                      BigDecimal chest, BigDecimal waist, BigDecimal arms, BigDecimal thighs,
                                      BigDecimal shoulders, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO member_progress (member_id, record_date, weight, body_fat, chest, waist,
                                         arms, thighs, shoulders, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            memberId, recordDate, weight, bodyFat, chest, waist, arms, thighs, shoulders, notes);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM member_progress WHERE id = ?", id);
    }
}
