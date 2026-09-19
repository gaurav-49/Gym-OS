package com.gymos.leads.controller;

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
import com.gymos.leads.service.LeadService;

/**
 * Lead (CRM) endpoints — mirrors backend/src/routes/leadsRoutes.js. All routes
 * are open to any authenticated staff (the Node backend has no role guard here).
 */
@RestController
@RequestMapping("/api/leads")
public class LeadController {

    private final LeadService leadService;

    public LeadController(LeadService leadService) {
        this.leadService = leadService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status,
                                          @RequestParam(required = false) String source,
                                          @RequestParam(required = false) String search) {
        return leadService.list(status, source, search);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(leadService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return leadService.update(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return leadService.delete(id);
    }

    @PostMapping("/{id}/convert")
    public ResponseEntity<Map<String, Object>> convert(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(leadService.convert(id, body));
    }
}
