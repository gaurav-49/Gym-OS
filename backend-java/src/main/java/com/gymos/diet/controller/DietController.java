package com.gymos.diet.controller;

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

import com.gymos.diet.service.DietService;

/**
 * Diet / nutrition plan endpoints — mirrors backend/src/routes/dietRoutes.js,
 * including the legacy /diets alias the Node backend exposes.
 */
@RestController
@RequestMapping("/api")
public class DietController {

    private final DietService dietService;

    public DietController(DietService dietService) {
        this.dietService = dietService;
    }

    @GetMapping({"/diet", "/diets"})
    public List<Map<String, Object>> list(@RequestParam(required = false) Long member_id) {
        return dietService.list(member_id);
    }

    @PostMapping({"/diet", "/diets"})
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(dietService.create(body));
    }

    @PutMapping({"/diet/{id}", "/diets/{id}"})
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return dietService.update(id, body);
    }

    @DeleteMapping({"/diet/{id}", "/diets/{id}"})
    public Map<String, Object> delete(@PathVariable Long id) {
        return dietService.delete(id);
    }
}
