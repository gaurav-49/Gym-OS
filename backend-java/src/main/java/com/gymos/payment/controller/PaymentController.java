package com.gymos.payment.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.util.Body;
import com.gymos.payment.service.PaymentService;

/**
 * Payments endpoints — mirrors backend/src/routes/paymentsRoutes.js. Reads are
 * open to any authenticated staff; writes are admin-only.
 */
@RestController
@RequestMapping("/api/payments")
public class PaymentController {

    private final PaymentService paymentService;

    public PaymentController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) Long member_id) {
        return paymentService.list(member_id);
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(paymentService.create(
            Body.toLong(body.get("member_id")), Body.str(body, "amount"),
            Body.str(body, "payment_date"), Body.str(body, "method"), Body.str(body, "note")));
    }

    @PostMapping("/collect-all")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> collectAll(@RequestBody(required = false) Map<String, Object> body) {
        String method = body == null ? null : Body.str(body, "method");
        return paymentService.collectAll(method);
    }

    @PostMapping("/{memberId}/collect")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> collect(@PathVariable Long memberId,
                                       @RequestBody(required = false) Map<String, Object> body) {
        String method = body == null ? null : Body.str(body, "method");
        return paymentService.collectDue(memberId, method);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> delete(@PathVariable Long id) {
        paymentService.delete(id);
        return Map.of("message", "Payment deleted");
    }
}
