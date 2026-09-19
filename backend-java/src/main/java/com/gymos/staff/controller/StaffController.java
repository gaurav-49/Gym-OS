package com.gymos.staff.controller;

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

import com.gymos.staff.service.StaffService;

/**
 * Staff attendance, rosters and payroll. Admin-only throughout — salaries,
 * commissions and payroll are not front-desk information.
 */
@RestController
@RequestMapping("/api/staff")
@PreAuthorize("hasRole('ADMIN')")
public class StaffController {

    private final StaffService staffService;

    public StaffController(StaffService staffService) {
        this.staffService = staffService;
    }

    @GetMapping
    public List<Map<String, Object>> listStaff() {
        return staffService.listStaff();
    }

    @PutMapping("/{id}/employment")
    public Map<String, Object> updateEmployment(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return staffService.updateEmployment(id, body);
    }

    // ---- attendance ----

    @GetMapping("/attendance")
    public List<Map<String, Object>> listAttendance(@RequestParam(required = false) String from,
                                                    @RequestParam(required = false) String to,
                                                    @RequestParam(name = "user_id", required = false) Long userId) {
        return staffService.listAttendance(from, to, userId);
    }

    @PostMapping("/attendance")
    public ResponseEntity<Map<String, Object>> markAttendance(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(staffService.markAttendance(body));
    }

    @DeleteMapping("/attendance/{id}")
    public Map<String, Object> deleteAttendance(@PathVariable Long id) {
        return staffService.deleteAttendance(id);
    }

    // ---- shifts ----

    @GetMapping("/shifts")
    public List<Map<String, Object>> listShifts(@RequestParam(required = false) String from,
                                                @RequestParam(required = false) String to,
                                                @RequestParam(name = "user_id", required = false) Long userId) {
        return staffService.listShifts(from, to, userId);
    }

    @PostMapping("/shifts")
    public ResponseEntity<Map<String, Object>> createShift(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(staffService.createShift(body));
    }

    @DeleteMapping("/shifts/{id}")
    public Map<String, Object> deleteShift(@PathVariable Long id) {
        return staffService.deleteShift(id);
    }

    // ---- payroll ----

    @GetMapping("/payroll")
    public List<Map<String, Object>> listPayroll(@RequestParam(required = false) String month,
                                                 @RequestParam(required = false) String year) {
        return staffService.listPayroll(month, year);
    }

    @PostMapping("/payroll/generate")
    public ResponseEntity<Map<String, Object>> generatePayroll(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(staffService.generatePayroll(body));
    }

    @PutMapping("/payroll/{id}")
    public Map<String, Object> updatePayroll(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return staffService.updatePayroll(id, body);
    }
}
