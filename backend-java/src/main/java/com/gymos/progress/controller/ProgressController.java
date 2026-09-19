package com.gymos.progress.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.progress.service.ProgressService;

/**
 * Member progress endpoints — mirrors backend/src/routes/progressRoutes.js.
 */
@RestController
@RequestMapping("/api/progress")
public class ProgressController {

    private final ProgressService progressService;

    public ProgressController(ProgressService progressService) {
        this.progressService = progressService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) Long member_id) {
        return progressService.list(member_id);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(progressService.create(body));
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return progressService.delete(id);
    }
}
