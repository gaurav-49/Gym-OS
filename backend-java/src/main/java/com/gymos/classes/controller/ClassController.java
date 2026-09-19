package com.gymos.classes.controller;

import java.util.LinkedHashMap;
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

import com.gymos.classes.service.ClassService;
import com.gymos.common.util.Body;

/**
 * Staff class-scheduling endpoints — mirrors backend/src/routes/classesRoutes.js.
 * Reads are open to any authenticated staff; writes require admin or trainer
 * (delete is admin-only), matching the Node requireRole guards.
 */
@RestController
@RequestMapping("/api/classes")
public class ClassController {

    private final ClassService classService;

    public ClassController(ClassService classService) {
        this.classService = classService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String include_past,
                                          @RequestParam(required = false) Long member_id) {
        return classService.getClasses(include_past, member_id);
    }

    @GetMapping("/trainers")
    public List<Map<String, Object>> trainers() {
        return classService.getTrainers();
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable Long id) {
        return classService.getClassDetail(id);
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'TRAINER')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(classService.createClass(body));
    }

    @PostMapping("/series")
    @PreAuthorize("hasAnyRole('ADMIN', 'TRAINER')")
    public ResponseEntity<Map<String, Object>> createSeries(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(classService.createSeries(body));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'TRAINER')")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return classService.updateClass(id, body);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> delete(@PathVariable Long id) {
        return classService.deleteClass(id);
    }

    @PostMapping("/{id}/book")
    @PreAuthorize("hasAnyRole('ADMIN', 'TRAINER')")
    public ResponseEntity<Map<String, Object>> book(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "member_id is required"));
        }
        Map<String, Object> result = classService.book(id, memberId);
        boolean waitlisted = "waitlisted".equals(result.get("status"));
        Map<String, Object> out = new LinkedHashMap<>();
        // memberId is clients.id — a number nobody at the desk has ever seen,
        // on a line read aloud to the member standing there. The service knows
        // who they are; say so, and fall back to the Member ID they carry
        // rather than the primary key they do not.
        Object who = result.get("memberName") != null ? result.get("memberName")
            : result.get("memberCode") != null ? result.get("memberCode") : null;
        out.put("message", waitlisted
            ? (who != null
                ? result.get("className") + " is full — " + who + " is on the waitlist."
                : result.get("className") + " is full — added to the waitlist.")
            : "Booked " + result.get("className") + " successfully.");
        out.put("status", result.get("status"));
        return ResponseEntity.status(waitlisted ? HttpStatus.ACCEPTED : HttpStatus.CREATED).body(out);
    }

    @PostMapping("/{id}/cancel-booking")
    @PreAuthorize("hasAnyRole('ADMIN', 'TRAINER')")
    public Map<String, Object> cancelBooking(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new com.gymos.common.api.BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        return bookingResponse(classService.cancelBooking(id, memberId));
    }

    static Map<String, Object> bookingResponse(Map<String, Object> result) {
        Object promoted = result.get("promoted");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Booking cancelled."
            + (promoted != null ? " " + promoted + " moved up from the waitlist." : ""));
        out.put("promoted", promoted);
        return out;
    }
}
