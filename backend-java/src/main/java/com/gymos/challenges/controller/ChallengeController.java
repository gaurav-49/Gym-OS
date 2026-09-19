package com.gymos.challenges.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
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

import com.gymos.challenges.service.ChallengeService;
import com.gymos.common.security.AuthUser;

/**
 * Challenges and leaderboards. Staff can run and score them; defining and
 * deleting a challenge is admin-only.
 */
@RestController
@RequestMapping("/api/challenges")
public class ChallengeController {

    private final ChallengeService challengeService;

    public ChallengeController(ChallengeService challengeService) {
        this.challengeService = challengeService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status) {
        return challengeService.list(status);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable Long id, @RequestParam(required = false) String limit) {
        return challengeService.get(id, limit);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(challengeService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return challengeService.update(id, body);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> delete(@PathVariable Long id) {
        return challengeService.delete(id);
    }

    @PostMapping("/{id}/join")
    public ResponseEntity<Map<String, Object>> join(@PathVariable Long id,
                                                    @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(challengeService.join(id, body));
    }

    @DeleteMapping("/{id}/participants/{memberId}")
    public Map<String, Object> leave(@PathVariable Long id, @PathVariable Long memberId) {
        return challengeService.leave(id, memberId);
    }

    /** Rescore a visit-based challenge from attendance. */
    @PostMapping("/{id}/refresh")
    public Map<String, Object> refresh(@PathVariable Long id) {
        return challengeService.refresh(id);
    }

    /** Record progress for a metric the app cannot measure itself. */
    @PutMapping("/{id}/participants/{memberId}/progress")
    public Map<String, Object> setProgress(@PathVariable Long id, @PathVariable Long memberId,
                                           @RequestBody Map<String, Object> body) {
        return challengeService.setProgress(id, memberId, body);
    }
}
