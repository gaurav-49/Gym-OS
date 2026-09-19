package com.gymos.assessments.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.assessments.dao.AssessmentDao;

@Repository
public class AssessmentDaoImpl implements AssessmentDao {

    /** Numeric measurement columns, in the order the insert binds them. */
    public static final List<String> MEASURES = List.of(
        "weight_kg", "height_cm", "body_fat_pct", "muscle_mass_kg", "visceral_fat", "bmi",
        "chest_cm", "waist_cm", "hip_cm", "arm_cm", "thigh_cm");

    private final JdbcTemplate jdbc;

    public AssessmentDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String SELECT = """
        SELECT a.*, c.name AS member_name, c.member_code, u.name AS assessed_by_name
        FROM assessments a
        JOIN clients c ON c.id = a.member_id
        LEFT JOIN users u ON u.id = a.assessed_by""";

    @Override
    public List<Map<String, Object>> findAssessments(Long memberId, String from, String to, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (memberId != null) {
            values.add(memberId);
            where.add("a.member_id = ?");
        }
        if (from != null && !from.isBlank()) {
            values.add(from);
            where.add("a.assessed_on >= ?::date");
        }
        if (to != null && !to.isBlank()) {
            values.add(to);
            where.add("a.assessed_on <= ?::date");
        }
        values.add(limit);
        String sql = SELECT
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY a.assessed_on DESC, a.id DESC\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList(SELECT + "\nWHERE a.id = ?", id).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> findForMember(Long memberId) {
        return jdbc.queryForList(
            "SELECT * FROM assessments WHERE member_id = ? ORDER BY assessed_on, id", memberId);
    }

    @Override
    public Map<String, Object> insert(Map<String, BigDecimal> measures, Long memberId, String assessedOn,
                                      Integer restingHr, String notes, Long assessedBy) {
        List<Object> params = new ArrayList<>();
        params.add(memberId);
        params.add(assessedOn);
        for (String column : MEASURES) {
            params.add(measures.get(column));
        }
        params.add(restingHr);
        params.add(notes);
        params.add(assessedBy);
        return jdbc.queryForMap("""
            INSERT INTO assessments (member_id, assessed_on, weight_kg, height_cm, body_fat_pct,
                                     muscle_mass_kg, visceral_fat, bmi, chest_cm, waist_cm, hip_cm,
                                     arm_cm, thigh_cm, resting_hr, notes, assessed_by)
            VALUES (?, COALESCE(?::date, CURRENT_DATE), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING *""", params.toArray());
    }

    @Override
    public Optional<Map<String, Object>> update(Long id, Map<String, BigDecimal> measures,
                                                Integer restingHr, String notes) {
        // COALESCE per column so a partial edit never blanks a measurement the
        // trainer did not re-take.
        StringBuilder sets = new StringBuilder();
        List<Object> params = new ArrayList<>();
        for (String column : MEASURES) {
            sets.append(sets.isEmpty() ? "" : ", ")
                .append(column).append(" = COALESCE(?, ").append(column).append(")");
            params.add(measures.get(column));
        }
        sets.append(", resting_hr = COALESCE(?, resting_hr), notes = COALESCE(?, notes)");
        params.add(restingHr);
        params.add(notes);
        params.add(id);
        return jdbc.queryForList("UPDATE assessments SET " + sets + " WHERE id = ? RETURNING *",
            params.toArray()).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> delete(Long id) {
        return jdbc.queryForList("DELETE FROM assessments WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    @Override
    public boolean memberExists(Long memberId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*)::int FROM clients WHERE id = ?",
            Integer.class, memberId);
        return n != null && n > 0;
    }
}
