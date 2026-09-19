package com.gymos.workout.service;

import java.util.List;
import java.util.Map;

/**
 * Workout plan service — mirrors workoutController.js.
 */
public interface WorkoutService {

    List<Map<String, Object>> list(Long memberId);

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
