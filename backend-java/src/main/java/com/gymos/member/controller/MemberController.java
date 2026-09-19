package com.gymos.member.controller;

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
import org.springframework.web.bind.annotation.RestController;

import com.gymos.member.service.MemberService;

/**
 * Members endpoints — mirrors backend/src/routes/clientRoutes.js. Reads are
 * open to any authenticated staff; writes are admin-only (@PreAuthorize).
 */
@RestController
@RequestMapping("/api")
public class MemberController {

    private final MemberService memberService;

    public MemberController(MemberService memberService) {
        this.memberService = memberService;
    }

    @GetMapping("/clients")
    public List<Map<String, Object>> listAll() {
        return memberService.listAll();
    }

    /**
     * The next free numeric Member ID, for a form that is about to create one.
     * Onboarding a lead used to have the server invent the ID silently; the
     * desk now sees it before saving and can overrule it.
     */
    @GetMapping("/clients/next-code")
    @PreAuthorize("hasAnyRole('ADMIN','STAFF')")
    public Map<String, Object> nextCode() {
        return Map.of("member_code", String.valueOf(memberService.nextMemberCode()));
    }

    @GetMapping("/clients/{id}")
    public Map<String, Object> get(@PathVariable Long id) {
        return memberService.get(id);
    }

    @GetMapping("/clients/{id}/events")
    public List<Map<String, Object>> events(@PathVariable Long id) {
        return memberService.events(id);
    }

    @PostMapping("/clients")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(memberService.create(body));
    }

    @PutMapping("/clients/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.update(id, body);
    }

    @DeleteMapping("/clients/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deactivate(@PathVariable Long id) {
        return memberService.deactivate(id);
    }

    /**
     * Permanently removes an inactive member — and only then does their Member
     * ID go back into circulation. Deactivating keeps both the record and the
     * number.
     */
    @DeleteMapping("/clients/{id}/purge")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> purge(@PathVariable Long id) {
        return memberService.purge(id);
    }

    @PutMapping("/clients/{id}/renew")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> renew(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.renew(id, body);
    }

    @PutMapping("/clients/{id}/renumber")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> renumber(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.renumber(id, body);
    }

    @PostMapping("/clients/{id}/freeze")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> freeze(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.freeze(id, body);
    }

    @PostMapping("/clients/{id}/resume")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> resume(@PathVariable Long id) {
        return memberService.resume(id);
    }

    @PostMapping("/clients/{id}/upgrade")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> upgrade(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.upgrade(id, body);
    }

    @PostMapping("/clients/{id}/cancel")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> cancel(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return memberService.cancel(id, body);
    }

    @PostMapping("/clients/{id}/fingerprint/enroll")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> enrollFingerprint(@PathVariable Long id) {
        return memberService.enrollFingerprint(id);
    }

    @PostMapping("/clients/{id}/fingerprint/enrolled")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> markFingerprintEnrolled(@PathVariable Long id) {
        return memberService.markFingerprintEnrolled(id);
    }

    @PostMapping("/clients/{id}/fingerprint/disable")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> disableFingerprint(@PathVariable Long id) {
        return memberService.disableFingerprint(id);
    }
}
