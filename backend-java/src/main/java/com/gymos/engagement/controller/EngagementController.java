package com.gymos.engagement.controller;

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

import com.gymos.common.security.AuthUser;
import com.gymos.engagement.service.EngagementService;

/**
 * Announcements and feedback.
 *
 * <p>Staff read the feed and the responses; only an admin posts to the whole
 * gym or removes a comment. The member-facing halves live on
 * {@link com.gymos.engagement.controller.MemberEngagementController}.
 */
@RestController
@RequestMapping("/api")
public class EngagementController {

    private final EngagementService engagementService;

    public EngagementController(EngagementService engagementService) {
        this.engagementService = engagementService;
    }

    @GetMapping("/announcements")
    public List<Map<String, Object>> listAnnouncements(@RequestParam(required = false) String audience,
                                                       @RequestParam(required = false) String live,
                                                       @RequestParam(required = false) String limit) {
        return engagementService.listAnnouncements(audience, live, limit);
    }

    @PostMapping("/announcements")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> createAnnouncement(@RequestBody Map<String, Object> body,
                                                                  @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(engagementService.createAnnouncement(body, user == null ? null : user.id()));
    }

    @PutMapping("/announcements/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateAnnouncement(@PathVariable Long id,
                                                  @RequestBody Map<String, Object> body) {
        return engagementService.updateAnnouncement(id, body);
    }

    @DeleteMapping("/announcements/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deleteAnnouncement(@PathVariable Long id) {
        return engagementService.deleteAnnouncement(id);
    }

    @GetMapping("/feedback")
    public List<Map<String, Object>> listFeedback(@RequestParam(name = "member_id", required = false) Long memberId,
                                                  @RequestParam(required = false) String category,
                                                  @RequestParam(required = false) String from,
                                                  @RequestParam(required = false) String limit) {
        return engagementService.listFeedback(memberId, category, from, limit);
    }

    @GetMapping("/feedback/summary")
    public Map<String, Object> feedbackSummary(@RequestParam(required = false) String days) {
        return engagementService.feedbackSummary(days);
    }

    /** Staff recording a comment taken at the desk. */
    @PostMapping("/feedback")
    public ResponseEntity<Map<String, Object>> recordFeedback(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(engagementService.submitFeedback(body, null));
    }

    @DeleteMapping("/feedback/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deleteFeedback(@PathVariable Long id) {
        return engagementService.deleteFeedback(id);
    }
}
