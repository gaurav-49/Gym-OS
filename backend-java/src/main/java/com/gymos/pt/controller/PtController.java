package com.gymos.pt.controller;

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

import com.gymos.pt.service.PtService;

/**
 * Personal training.
 *
 * <p>Trainers sell packages and log the sessions they deliver, so those routes
 * are open to any signed-in staff. Defining what is for sale — and deleting a
 * package — is admin-only.
 */
@RestController
@RequestMapping("/api/pt")
public class PtController {

    private final PtService ptService;

    public PtController(PtService ptService) {
        this.ptService = ptService;
    }

    // ---- packages ----

    @GetMapping("/packages")
    public List<Map<String, Object>> listPackages(@RequestParam(required = false) String active) {
        return ptService.listPackages(active);
    }

    @PostMapping("/packages")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> createPackage(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ptService.createPackage(body));
    }

    @PutMapping("/packages/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updatePackage(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ptService.updatePackage(id, body);
    }

    @DeleteMapping("/packages/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deletePackage(@PathVariable Long id) {
        return ptService.deletePackage(id);
    }

    // ---- subscriptions ----

    @GetMapping("/subscriptions")
    public List<Map<String, Object>> listSubscriptions(
            @RequestParam(name = "member_id", required = false) Long memberId,
            @RequestParam(name = "trainer_id", required = false) Long trainerId,
            @RequestParam(required = false) String status) {
        return ptService.listSubscriptions(memberId, trainerId, status);
    }

    @PostMapping("/subscriptions")
    public ResponseEntity<Map<String, Object>> sell(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ptService.sellSubscription(body));
    }

    @PutMapping("/subscriptions/{id}")
    public Map<String, Object> updateSubscription(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ptService.updateSubscription(id, body);
    }

    @PostMapping("/subscriptions/{id}/session")
    public ResponseEntity<Map<String, Object>> logSession(@PathVariable Long id,
                                                          @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ptService.logSession(id, body));
    }

    @GetMapping("/subscriptions/{id}/sessions")
    public List<Map<String, Object>> listSessions(@PathVariable Long id) {
        return ptService.listSessions(id);
    }

    // ---- commissions ----

    @GetMapping("/commissions")
    public List<Map<String, Object>> listCommissions(
            @RequestParam(name = "trainer_id", required = false) Long trainerId,
            @RequestParam(required = false) String status) {
        return ptService.listCommissions(trainerId, status);
    }
}
