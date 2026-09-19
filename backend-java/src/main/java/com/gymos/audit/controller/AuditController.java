package com.gymos.audit.controller;

import java.util.List;
import java.util.Map;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.audit.service.AuditLogService;

/**
 * Audit log. Read-only on purpose — there is no POST/PUT/DELETE here, so a
 * signed-in operator cannot edit the record of what they did. Admin-only,
 * because the trail names staff and what they changed.
 */
@RestController
@RequestMapping("/api/audit")
@PreAuthorize("hasRole('ADMIN')")
public class AuditController {

    private final AuditLogService auditLogService;

    public AuditController(AuditLogService auditLogService) {
        this.auditLogService = auditLogService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String module,
                                          @RequestParam(required = false) String action,
                                          @RequestParam(name = "user_id", required = false) Long userId,
                                          @RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to,
                                          @RequestParam(required = false) String search,
                                          @RequestParam(required = false) String limit) {
        return auditLogService.search(module, action, userId, from, to, search, limit);
    }

    @GetMapping("/summary")
    public Map<String, Object> summary() {
        return auditLogService.summary();
    }
}
