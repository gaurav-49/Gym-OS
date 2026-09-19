package com.gymos.workout.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * Workout plan data access. All SQL lives in
 * {@link com.gymos.workout.dao.impl.WorkoutDaoImpl}.
 */
public interface WorkoutDao {

    List<Map<String, Object>> findByMember(Long memberId);

    Map<String, Object> insert(Long memberId, String day, String exercise, Integer sets, Integer reps,
                               BigDecimal weight, Integer restSeconds, String notes);

    Map<String, Object> update(Long id, String day, String exercise, Integer sets, Integer reps,
                               BigDecimal weight, Integer restSeconds, String notes);

    int delete(Long id);
}
