package com.gymos.plans.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.plans.service.PlanService;

/**
 * Membership plans. Any signed-in staff member can read the catalogue (the
 * member and lead forms need it); only an admin can change what the gym sells.
 */
@RestController
@RequestMapping("/api/plans")
public class PlanController {

    private final PlanService planService;

    public PlanController(PlanService planService) {
        this.planService = planService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String active) {
        return planService.list("true".equals(active));
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(planService.create(body));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return planService.update(id, body);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> delete(@PathVariable Long id) {
        return planService.delete(id);
    }
}
