package com.gymos.workout.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.workout.service.WorkoutService;

/**
 * Workout plan endpoints — mirrors backend/src/routes/workoutRoutes.js.
 */
@RestController
@RequestMapping("/api/workouts")
public class WorkoutController {

    private final WorkoutService workoutService;

    public WorkoutController(WorkoutService workoutService) {
        this.workoutService = workoutService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) Long member_id) {
        return workoutService.list(member_id);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(workoutService.create(body));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return workoutService.update(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return workoutService.delete(id);
    }
}
