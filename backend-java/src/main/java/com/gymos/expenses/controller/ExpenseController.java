package com.gymos.expenses.controller;

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
import com.gymos.expenses.service.ExpenseService;

/**
 * Expenses and the P&amp;L. Admin-only throughout — what the gym spends and what
 * it makes is not front-desk information.
 */
@RestController
@RequestMapping("/api")
@PreAuthorize("hasRole('ADMIN')")
public class ExpenseController {

    private final ExpenseService expenseService;

    public ExpenseController(ExpenseService expenseService) {
        this.expenseService = expenseService;
    }

    @GetMapping("/expenses")
    public List<Map<String, Object>> list(@RequestParam(required = false) String from,
                                          @RequestParam(required = false) String to,
                                          @RequestParam(required = false) String category,
                                          @RequestParam(required = false) String search) {
        return expenseService.list(from, to, category, search);
    }

    @PostMapping("/expenses")
    public ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body,
                                                      @AuthenticationPrincipal AuthUser user) {
        return ResponseEntity.status(HttpStatus.CREATED)
            .body(expenseService.create(body, user == null ? null : user.id()));
    }

    @PutMapping("/expenses/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return expenseService.update(id, body);
    }

    @DeleteMapping("/expenses/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        return expenseService.delete(id);
    }

    /** Month-by-month income vs expenses vs profit, for the Finance page. */
    @GetMapping("/finance/summary")
    public Map<String, Object> financeSummary(@RequestParam(required = false) String months) {
        return expenseService.financeSummary(months);
    }
}
