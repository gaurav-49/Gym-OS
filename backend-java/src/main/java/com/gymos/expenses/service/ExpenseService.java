package com.gymos.expenses.service;

import java.util.List;
import java.util.Map;

/**
 * Expenses and the profit-and-loss view.
 *
 * <p>{@code payments} only ever recorded income, so 1.0 could show collections
 * but never profitability. The finance summary joins both sides — memberships
 * plus counter sales minus expenses — into a month-by-month P&amp;L.
 */
public interface ExpenseService {

    List<Map<String, Object>> list(String from, String to, String category, String search);

    Map<String, Object> create(Map<String, Object> body, Long recordedBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);

    /** @param months how far back to chart, 1–24 */
    Map<String, Object> financeSummary(String months);
}
