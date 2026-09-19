package com.gymos.classes.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.classes.service.ClassService;
import com.gymos.common.security.AuthUser;

/**
 * Member self-service class booking — mirrors the /api/member/classes routes in
 * classesRoutes.js. Protected by the short-lived member JWT (role MEMBER);
 * /verify is the public handshake that issues it.
 */
@RestController
@RequestMapping("/api/member/classes")
public class MemberClassController {

    private final ClassService classService;

    public MemberClassController(ClassService classService) {
        this.classService = classService;
    }

    @PostMapping("/verify")
    public Map<String, Object> verify(@RequestBody Map<String, Object> body) {
        return classService.verifyMember(
            body.get("member_code") == null ? null : String.valueOf(body.get("member_code")),
            body.get("password") == null ? null : String.valueOf(body.get("password")));
    }

    @GetMapping
    public List<Map<String, Object>> list(@AuthenticationPrincipal AuthUser user) {
        return classService.memberClasses(user.id());
    }

    @GetMapping("/my")
    public List<Map<String, Object>> myBookings(@AuthenticationPrincipal AuthUser user) {
        return classService.myBookings(user.id());
    }

    @PostMapping("/{id}/book")
    public ResponseEntity<Map<String, Object>> book(@PathVariable Long id, @AuthenticationPrincipal AuthUser user) {
        Map<String, Object> result = classService.memberBook(id, user.id());
        boolean waitlisted = "waitlisted".equals(result.get("status"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", waitlisted
            ? result.get("className") + " is full — you're on the waitlist."
            : "Booked " + result.get("className") + ". See you there!");
        out.put("status", result.get("status"));
        return ResponseEntity.status(waitlisted ? HttpStatus.ACCEPTED : HttpStatus.CREATED).body(out);
    }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable Long id, @AuthenticationPrincipal AuthUser user) {
        return ClassController.bookingResponse(classService.memberCancel(id, user.id()));
    }
}
