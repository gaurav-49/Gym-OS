package com.gymos.assessments.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.assessments.service.AssessmentService;
import com.gymos.common.security.AuthUser;

/** Body-composition assessments. Trainers record and review these, so staff-wide. */
@RestController
@RequestMapping("/api/assessments")
public class AssessmentController {

    private final AssessmentService assessmentService;

    public AssessmentController(AssessmentService assessmentService) {
        this.assessmentService = assessmentService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(name = "member_id", required = false) Long memberId,
                                          @RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to,
                                          @RequestParam(required = false) String limit) {
        return assessmentService.list(memberId, from, to, limit);
    }

    /** Full history plus change since the first and the previous assessment. */
    @GetMapping("/member/{memberId}")
    public Map<String, Object> memberProgress(@PathVariable Long memberId) {
        return assessmentService.memberProgress(memberId);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(assessmentService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return assessmentService.update(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return assessmentService.delete(id);
    }
}
