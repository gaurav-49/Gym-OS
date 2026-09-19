package com.gymos.lockers.controller;

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

import com.gymos.lockers.service.LockerService;

/**
 * Lockers. Any signed-in staff member can see the board (the front desk needs
 * to answer "is 14 free?"); creating, assigning and releasing is admin-only.
 */
@RestController
@RequestMapping("/api/lockers")
public class LockerController {

    private final LockerService lockerService;

    public LockerController(LockerService lockerService) {
        this.lockerService = lockerService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status,
                                          @RequestParam(required = false) String search) {
        return lockerService.list(status, search);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(lockerService.create(body));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return lockerService.update(id, body);
    }

    @PostMapping("/{id}/assign")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> assign(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return lockerService.assign(id, body);
    }

    @PostMapping("/{id}/release")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> release(@PathVariable Long id) {
        return lockerService.release(id);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> delete(@PathVariable Long id) {
        return lockerService.delete(id);
    }
}
