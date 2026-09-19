package com.gymos.referrals.controller;

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

import com.gymos.common.security.AuthUser;
import com.gymos.referrals.service.ReferralService;

/** Referrals. The front desk records and settles these, so staff-wide. */
@RestController
@RequestMapping("/api/referrals")
public class ReferralController {

    private final ReferralService referralService;

    public ReferralController(ReferralService referralService) {
        this.referralService = referralService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(name = "referrer_id", required = false) Long referrerId,
                                          @RequestParam(required = false) String status,
                                          @RequestParam(required = false) String limit) {
        return referralService.list(referrerId, status, limit);
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(@RequestParam(required = false) String limit) {
        return referralService.summary(limit);
    }

    /** "Who sent you?" — resolve a shareable code to the member who owns it. */
    @GetMapping("/code/{code}")
    public Map<String, Object> lookupCode(@PathVariable String code) {
        return referralService.lookupCode(code);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(referralService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return referralService.update(id, body);
    }

    /** Link the member this referral became. */
    @PostMapping("/{id}/joined")
    public Map<String, Object> markJoined(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return referralService.markJoined(id, body);
    }

    @PostMapping("/{id}/reward")
    public Map<String, Object> payReward(@PathVariable Long id) {
        return referralService.payReward(id);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return referralService.delete(id);
    }
}
