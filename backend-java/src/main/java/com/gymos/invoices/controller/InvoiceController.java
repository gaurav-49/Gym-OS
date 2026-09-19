package com.gymos.invoices.controller;

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
import com.gymos.invoices.service.InvoiceService;

/**
 * Tax invoices. The desk issues and settles them; only an admin can cancel one,
 * because cancelling is what takes a number out of circulation.
 */
@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {

    private final InvoiceService invoiceService;

    public InvoiceController(InvoiceService invoiceService) {
        this.invoiceService = invoiceService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to,
                                          @RequestParam(name = "member_id", required = false) Long memberId,
                                          @RequestParam(required = false) String status,
                                          @RequestParam(required = false) String search) {
        return invoiceService.list(from, to, memberId, status, search);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable Long id) {
        return invoiceService.get(id);
    }

    @PostMapping
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(invoiceService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return invoiceService.update(id, body);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> cancel(@PathVariable Long id) {
        return invoiceService.cancel(id);
    }
}
