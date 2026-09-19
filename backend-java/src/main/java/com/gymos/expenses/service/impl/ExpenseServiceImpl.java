package com.gymos.expenses.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.expenses.dao.ExpenseDao;
import com.gymos.expenses.service.ExpenseService;

@Service
public class ExpenseServiceImpl implements ExpenseService {

    private static final List<String> CATEGORIES = List.of(
        "Rent", "Salaries", "Utilities", "Equipment", "Maintenance",
        "Marketing", "Supplies", "Insurance", "Taxes", "Other");

    private static final int DEFAULT_MONTHS = 6;
    private static final int MAX_MONTHS = 24;

    private final ExpenseDao expenseDao;
    private final AuditService audit;

    public ExpenseServiceImpl(ExpenseDao expenseDao, AuditService audit) {
        this.expenseDao = expenseDao;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(String from, String to, String category, String search) {
        requireFilterDate("from", from);
        requireFilterDate("to", to);
        // from after to silently returned an empty list, which reads as "no
        // expenses in this period" rather than "you asked for a period that
        // does not exist".
        String order = Dates.orderError("from", from, "to", to);
        if (order != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, order);
        }
        return expenseDao.findExpenses(from, to, category, search);
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long recordedBy) {
        String category = Body.str(body, "category");
        if (category == null || !CATEGORIES.contains(category)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "category must be one of: " + String.join(", ", CATEGORIES));
        }
        String description = Body.str(body, "description");
        if (description == null || description.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Description is required");
        }
        BigDecimal amount = amountOf(body, true);
        String expenseDate = Body.str(body, "expense_date");
        requireDate("expense_date", expenseDate);
        String method = Body.str(body, "method");
        if (!PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        Map<String, Object> expense = expenseDao.insert(category, description.trim(), amount,
            blankToNull(expenseDate), method == null || method.isBlank() ? "Cash" : method,
            Body.str(body, "vendor"), Body.str(body, "reference"), recordedBy);
        audit.record("create", "expenses", expense.get("id"),
            "Recorded " + category + " expense ₹" + amount + " — " + description.trim());
        return expense;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String category = body.containsKey("category") ? Body.str(body, "category") : null;
        if (category != null && !CATEGORIES.contains(category)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "category must be one of: " + String.join(", ", CATEGORIES));
        }
        String description = body.containsKey("description") ? Body.str(body, "description") : null;
        if (body.containsKey("description") && (description == null || description.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Description is required");
        }
        BigDecimal amount = amountOf(body, false);
        String expenseDate = Body.str(body, "expense_date");
        requireDate("expense_date", expenseDate);
        String method = body.containsKey("method") ? Body.str(body, "method") : null;
        if (method != null && !PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        Map<String, Object> updated = expenseDao.update(id, category,
            description == null ? null : description.trim(), amount, blankToNull(expenseDate), method,
            body.containsKey("vendor") ? Body.str(body, "vendor") : null,
            body.containsKey("reference") ? Body.str(body, "reference") : null)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Expense not found"));
        audit.record("update", "expenses", id, "Updated expense #" + id);
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> expense = expenseDao.delete(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Expense not found"));
        audit.record("delete", "expenses", id,
            "Deleted " + expense.get("category") + " expense ₹" + expense.get("amount"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Expense deleted.");
        out.put("expense", expense);
        return out;
    }

    @Override
    public Map<String, Object> financeSummary(String monthsRaw) {
        int months = clampMonths(monthsRaw);

        List<Map<String, Object>> membership = expenseDao.membershipIncomeByMonth(months);
        List<Map<String, Object>> pos = expenseDao.posIncomeByMonth(months);
        List<Map<String, Object>> spend = expenseDao.expensesByMonth(months);

        // Stitch the three series into one row per month so the UI can chart
        // income vs expense vs profit without having to align keys itself.
        Set<String> allMonths = new TreeSet<>();
        for (List<Map<String, Object>> rows : List.of(membership, pos, spend)) {
            for (Map<String, Object> row : rows) {
                allMonths.add(String.valueOf(row.get("month")));
            }
        }

        List<Map<String, Object>> series = new java.util.ArrayList<>();
        for (String month : allMonths) {
            double memberships = at(membership, month);
            double posSales = at(pos, month);
            double outgoing = at(spend, month);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("month", month);
            row.put("membership_income", memberships);
            row.put("pos_income", posSales);
            row.put("income", round(memberships + posSales));
            row.put("expenses", outgoing);
            row.put("profit", round(memberships + posSales - outgoing));
            series.add(row);
        }

        Map<String, Object> t = expenseDao.financeTotals();
        double monthMembership = num(t.get("month_membership"));
        double monthPos = num(t.get("month_pos"));
        double monthExpenses = num(t.get("month_expenses"));
        double todayIncome = num(t.get("today_membership")) + num(t.get("today_pos"));
        double todayExpenses = num(t.get("today_expenses"));
        double monthIncome = monthMembership + monthPos;

        Map<String, Object> totals = new LinkedHashMap<>();
        totals.put("month_income", round(monthIncome));
        totals.put("month_membership", monthMembership);
        totals.put("month_pos", monthPos);
        totals.put("month_expenses", monthExpenses);
        totals.put("month_profit", round(monthIncome - monthExpenses));
        totals.put("today_income", round(todayIncome));
        totals.put("today_expenses", todayExpenses);
        totals.put("today_profit", round(todayIncome - todayExpenses));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("months", months);
        out.put("series", series);
        out.put("expense_by_category", expenseDao.expensesByCategory(months));
        out.put("totals", totals);
        return out;
    }

    // ---- helpers -------------------------------------------------------------

    private static double at(List<Map<String, Object>> rows, String month) {
        for (Map<String, Object> row : rows) {
            if (month.equals(String.valueOf(row.get("month")))) {
                return num(row.get("total"));
            }
        }
        return 0d;
    }

    private static double num(Object v) {
        return v instanceof Number n ? n.doubleValue() : 0d;
    }

    /** Money to two decimals — a float sum can otherwise surface 4499.999999997. */
    private static double round(double v) {
        return BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    /**
     * A date used to FILTER, not to record. Format only — plus an order check
     * on the pair. requireDate refuses a future date because an expense is
     * money already spent; applying that to a filter bound meant "everything
     * up to 31 Dec" came back 400, and there was no way to ask the ledger for
     * the rest of the month.
     */
    private static void requireFilterDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
        // An expense is money already spent. Dating it forward puts it in a
        // future month's P&L, so this month's profit reads high and next
        // month's reads low, with nothing on either statement to explain it.
        if (Dates.isFuture(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "An expense cannot be dated in the future (" + Dates.friendly(value) + ").");
        }
    }

    private static BigDecimal amountOf(Map<String, Object> body, boolean required) {
        Object raw = body.get("amount");
        boolean absent = raw == null || String.valueOf(raw).isBlank();
        if (absent) {
            if (required) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "amount must be a non-negative number");
            }
            return null;
        }
        BigDecimal amount = Body.toDecimal(raw);
        // Greater than zero, not merely non-negative. A ₹0 expense is a row
        // with nothing in it: it adds a line to the ledger, a slice to the
        // category chart and a count to the month, and moves no money.
        if (amount == null || amount.signum() <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount must be greater than zero");
        }
        return amount;
    }

    private static int clampMonths(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_MONTHS;
        }
        try {
            return Math.min(MAX_MONTHS, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_MONTHS;
        }
    }
}
