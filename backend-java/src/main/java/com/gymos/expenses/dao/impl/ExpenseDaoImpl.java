package com.gymos.expenses.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.expenses.dao.ExpenseDao;

@Repository
public class ExpenseDaoImpl implements ExpenseDao {

    /** Hard cap on the expense list — the UI pages, the API should not stream forever. */
    private static final int LIST_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public ExpenseDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findExpenses(String from, String to, String category, String search) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(from)) {
            values.add(from);
            where.add("e.expense_date >= ?");
        }
        if (isSet(to)) {
            values.add(to);
            where.add("e.expense_date <= ?");
        }
        if (isSet(category)) {
            values.add(category);
            where.add("e.category = ?");
        }
        if (isSet(search)) {
            String like = "%" + search.toLowerCase() + "%";
            values.add(like);
            values.add(like);
            where.add("(LOWER(e.description) LIKE ? OR LOWER(COALESCE(e.vendor, '')) LIKE ?)");
        }
        String sql = """
            SELECT e.*, u.name AS recorded_by_name
            FROM expenses e
            LEFT JOIN users u ON u.id = e.recorded_by"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY e.expense_date DESC, e.id DESC\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    private static boolean isSet(String v) {
        return v != null && !v.isBlank();
    }

    @Override
    public Map<String, Object> insert(String category, String description, BigDecimal amount, String expenseDate,
                                      String method, String vendor, String reference, Long recordedBy) {
        return jdbc.queryForMap("""
            INSERT INTO expenses (category, description, amount, expense_date, method, vendor, reference, recorded_by)
            VALUES (?, ?, ?, COALESCE(?::date, CURRENT_DATE), ?, ?, ?, ?) RETURNING *""",
            category, description, amount, expenseDate, method, vendor, reference, recordedBy);
    }

    @Override
    public Optional<Map<String, Object>> update(Long id, String category, String description, BigDecimal amount,
                                                String expenseDate, String method, String vendor, String reference) {
        return jdbc.queryForList("""
            UPDATE expenses SET
                category = COALESCE(?, category),
                description = COALESCE(?, description),
                amount = COALESCE(?, amount),
                expense_date = COALESCE(?::date, expense_date),
                method = COALESCE(?, method),
                vendor = COALESCE(?, vendor),
                reference = COALESCE(?, reference)
            WHERE id = ? RETURNING *""",
            category, description, amount, expenseDate, method, vendor, reference, id)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> delete(Long id) {
        return jdbc.queryForList("DELETE FROM expenses WHERE id = ? RETURNING *", id).stream().findFirst();
    }

    // ---- finance summary -----------------------------------------------------

    @Override
    public List<Map<String, Object>> membershipIncomeByMonth(int months) {
        return monthly("payments", "payment_date", "amount", months);
    }

    @Override
    public List<Map<String, Object>> posIncomeByMonth(int months) {
        return monthly("product_sales", "sale_date", "total", months);
    }

    @Override
    public List<Map<String, Object>> expensesByMonth(int months) {
        return monthly("expenses", "expense_date", "amount", months);
    }

    // Table/column names here are compile-time literals from the three callers
    // above — never anything a request supplied.
    private List<Map<String, Object>> monthly(String table, String dateCol, String amountCol, int months) {
        return jdbc.queryForList(
            "SELECT TO_CHAR(" + dateCol + ", 'YYYY-MM') AS month,"
                + " COALESCE(SUM(" + amountCol + "), 0)::float8 AS total"
                + " FROM " + table
                + " WHERE " + dateCol + " >= (CURRENT_DATE - (? || ' months')::interval)"
                // The window had a floor and no ceiling, so one row dated 2099
                // put a 2099-12 column on a chart captioned "last 6 months" and
                // stretched the x-axis across 73 empty years. Future money is
                // not this month's P&L wherever it came from — a payment or a
                // POS sale can still carry a date the expense rules now refuse.
                + " AND " + dateCol + " < (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')"
                + " GROUP BY 1 ORDER BY 1",
            String.valueOf(months));
    }

    @Override
    public List<Map<String, Object>> expensesByCategory(int months) {
        return jdbc.queryForList("""
            SELECT category, COALESCE(SUM(amount), 0)::float8 AS total
            FROM expenses
            WHERE expense_date >= (CURRENT_DATE - (? || ' months')::interval)
            GROUP BY 1 ORDER BY 2 DESC""", String.valueOf(months));
    }

    @Override
    public Map<String, Object> financeTotals() {
        return jdbc.queryForMap("""
            SELECT
                (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments
                  WHERE DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE)) AS month_membership,
                (SELECT COALESCE(SUM(total), 0)::float8 FROM product_sales
                  WHERE DATE_TRUNC('month', sale_date) = DATE_TRUNC('month', CURRENT_DATE)) AS month_pos,
                (SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses
                  WHERE DATE_TRUNC('month', expense_date) = DATE_TRUNC('month', CURRENT_DATE)) AS month_expenses,
                (SELECT COALESCE(SUM(amount), 0)::float8 FROM payments
                  WHERE payment_date = CURRENT_DATE) AS today_membership,
                (SELECT COALESCE(SUM(total), 0)::float8 FROM product_sales
                  WHERE sale_date = CURRENT_DATE) AS today_pos,
                (SELECT COALESCE(SUM(amount), 0)::float8 FROM expenses
                  WHERE expense_date = CURRENT_DATE) AS today_expenses""");
    }
}
