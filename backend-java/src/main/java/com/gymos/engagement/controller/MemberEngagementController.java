package com.gymos.engagement.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.security.AuthUser;
import com.gymos.engagement.service.EngagementService;

/**
 * The member's side of the feed: read what the gym posted, and say something back.
 *
 * <p>Member-only, and the feedback is always attributed to the token's own
 * member id — a member cannot post a review in somebody else's name.
 */
@RestController
@RequestMapping("/api/member")
@PreAuthorize("hasRole('MEMBER')")
public class MemberEngagementController {

    private final EngagementService engagementService;

    public MemberEngagementController(EngagementService engagementService) {
        this.engagementService = engagementService;
    }

    /** Only what is live today, and only posts aimed at members. */
    @GetMapping("/announcements")
    public List<Map<String, Object>> feed() {
        return engagementService.listAnnouncements("active", "true", "20");
    }

    @PostMapping("/feedback")
    public ResponseEntity<Map<String, Object>> submit(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(engagementService.submitFeedback(body, user == null ? null : user.id()));
    }
}
