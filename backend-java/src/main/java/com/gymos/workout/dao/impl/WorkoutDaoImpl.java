package com.gymos.workout.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.workout.dao.WorkoutDao;

@Repository
public class WorkoutDaoImpl implements WorkoutDao {

    private final JdbcTemplate jdbc;

    public WorkoutDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findByMember(Long memberId) {
        return jdbc.queryForList("SELECT * FROM workout_plans WHERE member_id = ? ORDER BY id", memberId);
    }

    @Override
    public Map<String, Object> insert(Long memberId, String day, String exercise, Integer sets, Integer reps,
                                      BigDecimal weight, Integer restSeconds, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO workout_plans (member_id, day, exercise, sets, reps, weight, rest_seconds, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            memberId, day, exercise, sets, reps, weight, restSeconds, notes);
    }

    @Override
    public Map<String, Object> update(Long id, String day, String exercise, Integer sets, Integer reps,
                                      BigDecimal weight, Integer restSeconds, String notes) {
        return jdbc.queryForMap("""
            UPDATE workout_plans SET
                day = COALESCE(?, day),
                exercise = COALESCE(?, exercise),
                sets = COALESCE(?, sets),
                reps = COALESCE(?, reps),
                weight = COALESCE(?, weight),
                rest_seconds = COALESCE(?, rest_seconds),
                notes = COALESCE(?, notes)
            WHERE id = ? RETURNING *""", day, exercise, sets, reps, weight, restSeconds, notes, id);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM workout_plans WHERE id = ?", id);
    }
}
