package com.gymos.billing.controller;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.billing.service.BillingService;
import com.gymos.common.util.Body;

/**
 * Billing endpoints — mirrors backend/src/routes/billingRoutes.js. Reads are
 * open to any authenticated staff; writes are admin-only.
 */
@RestController
@RequestMapping("/api/billing")
public class BillingController {

    private final BillingService billingService;

    public BillingController(BillingService billingService) {
        this.billingService = billingService;
    }

    @GetMapping("/overview")
    public Map<String, Object> overview() {
        return billingService.getOverview();
    }

    @PutMapping("/settings")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateSettings(@RequestBody Map<String, Object> body) {
        return billingService.saveSettings(body);
    }

    @PutMapping("/members/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateMemberBilling(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        Map<String, Object> member = billingService.setMemberBilling(id, body);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Billing updated for " + member.get("name") + ".");
        out.put("member", Map.of(
            "id", member.get("id"),
            "member_code", member.get("member_code"),
            "name", member.get("name"),
            "auto_renew", member.get("auto_renew"),
            "recurring_method", member.get("recurring_method")));
        return out;
    }

    @PostMapping("/members/{id}/retry")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> retry(@PathVariable Long id) {
        Map<String, Object> result = billingService.retryMember(id);
        String status = String.valueOf(result.get("status"));
        Map<String, Object> out = new LinkedHashMap<>();
        if ("renewed".equals(status)) {
            out.put("message", "Auto-renew succeeded for member " + id
                + " — membership valid until " + result.get("new_expiry") + ".");
            out.put("status", status);
            out.put("new_expiry", result.get("new_expiry"));
            out.put("receipt", result.get("receipt"));
            return ResponseEntity.ok(out);
        }
        if ("already_renewed".equals(status)) {
            out.put("message", "This membership was already auto-renewed for this cycle.");
            out.put("status", status);
            return ResponseEntity.ok(out);
        }
        String error = "retry_not_due".equals(status)
            ? "A retry is already scheduled — it is not due yet."
            : "Charge failed (attempt " + result.get("attempt_count")
                + "): no recurring payment method on file."
                + (Boolean.TRUE.equals(result.get("paused")) ? " Auto-renew paused after max attempts." : "");
        out.put("error", error);
        out.put("status", status);
        out.put("attempt_count", result.get("attempt_count"));
        out.put("dunning_sent", result.get("dunning_sent"));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(out);
    }

    @PostMapping("/members/{id}/mark-paid")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> markPaid(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> bodyOrEmpty = body == null ? Map.of() : body;
        Map<String, Object> result = billingService.markPaid(id, Body.str(bodyOrEmpty, "amount"), Body.str(bodyOrEmpty, "method"));
        Map<String, Object> member = (Map<String, Object>) result.get("member");
        java.math.BigDecimal amountDue = (java.math.BigDecimal) result.get("amount_due");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Renewal recorded for " + member.get("name") + " — valid until "
            + result.get("new_expiry") + "."
            + (amountDue.signum() > 0 ? " Amount due: ₹" + amountDue.toPlainString() + "." : " Fully paid."));
        out.put("member", member);
        out.put("new_expiry", result.get("new_expiry"));
        out.put("amount_due", amountDue);
        out.put("receipt", result.get("receipt"));
        return out;
    }

    @PostMapping("/members/{id}/pause")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> pause(@PathVariable Long id) {
        return billingService.pauseMember(id);
    }
}
