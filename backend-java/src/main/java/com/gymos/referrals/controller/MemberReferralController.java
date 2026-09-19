package com.gymos.referrals.controller;

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
import com.gymos.referrals.service.ReferralService;

/**
 * A member's own referrals.
 *
 * <p>Member-only, and every query is scoped to the id inside the caller's own
 * token — a member can never read or credit somebody else's referrals, which
 * is why this is separate from the staff-facing /api/referrals.
 */
@RestController
@RequestMapping("/api/member/referrals")
@PreAuthorize("hasRole('MEMBER')")
public class MemberReferralController {

    private final ReferralService referralService;

    public MemberReferralController(ReferralService referralService) {
        this.referralService = referralService;
    }

    @GetMapping
    public Map<String, Object> mine(@AuthenticationPrincipal AuthUser user) {
        return referralService.memberSummary(user.id());
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> invite(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(referralService.inviteFromPortal(user.id(), body));
    }
}
