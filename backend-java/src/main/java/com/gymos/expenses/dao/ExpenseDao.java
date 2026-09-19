package com.gymos.expenses.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Expenses — the outgoing half of the ledger, plus the queries that turn both
 * halves into a profit-and-loss view.
 */
public interface ExpenseDao {

    List<Map<String, Object>> findExpenses(String from, String to, String category, String search);

    Map<String, Object> insert(String category, String description, BigDecimal amount, String expenseDate,
                               String method, String vendor, String reference, Long recordedBy);

    Optional<Map<String, Object>> update(Long id, String category, String description, BigDecimal amount,
                                         String expenseDate, String method, String vendor, String reference);

    Optional<Map<String, Object>> delete(Long id);

    // ---- finance summary ----

    /** Membership payments per month, newest N months. */
    List<Map<String, Object>> membershipIncomeByMonth(int months);

    /** Counter (product) sales per month. */
    List<Map<String, Object>> posIncomeByMonth(int months);

    List<Map<String, Object>> expensesByMonth(int months);

    List<Map<String, Object>> expensesByCategory(int months);

    /** This month's and today's income/expense figures in one row. */
    Map<String, Object> financeTotals();
}
