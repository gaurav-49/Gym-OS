package com.gymos.staff.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.staff.dao.StaffDao;

@Repository
public class StaffDaoImpl implements StaffDao {

    private static final int LIST_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public StaffDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findStaff() {
        return jdbc.queryForList("""
            SELECT u.id, u.username, u.name, u.role, u.email, u.phone,
                   COALESCE(u.monthly_salary, 0) AS monthly_salary,
                   COALESCE(u.commission_percent, 0) AS commission_percent,
                   u.joined_on,
                   (SELECT sa.status FROM staff_attendance sa
                     WHERE sa.user_id = u.id AND sa.work_date = CURRENT_DATE) AS today_status,
                   (SELECT COUNT(*)::int FROM staff_attendance sa
                     WHERE sa.user_id = u.id AND sa.status = 'Present'
                       AND DATE_TRUNC('month', sa.work_date) = DATE_TRUNC('month', CURRENT_DATE)) AS present_this_month,
                   (SELECT COALESCE(SUM(cm.amount), 0)::float8 FROM commissions cm
                     WHERE cm.trainer_id = u.id AND cm.status = 'pending') AS pending_commission
            FROM users u
            ORDER BY u.role, u.name""");
    }

    @Override
    public Optional<Map<String, Object>> findUser(Long id) {
        return jdbc.queryForList("SELECT id, name FROM users WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> updateEmployment(Long id, BigDecimal monthlySalary,
                                                          BigDecimal commissionPercent, String joinedOn) {
        return jdbc.queryForList("""
            UPDATE users SET
                monthly_salary = COALESCE(?, monthly_salary),
                commission_percent = COALESCE(?, commission_percent),
                joined_on = COALESCE(?::date, joined_on)
            WHERE id = ?
            RETURNING id, username, name, role, monthly_salary, commission_percent, joined_on""",
            monthlySalary, commissionPercent, joinedOn, id).stream().findFirst();
    }

    // ---- attendance ----------------------------------------------------------

    @Override
    public List<Map<String, Object>> findAttendance(String from, String to, Long userId) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        addRange(where, values, "sa.work_date", from, to, userId, "sa.user_id");
        String sql = """
            SELECT sa.*, u.name AS staff_name, u.username, u.role
            FROM staff_attendance sa
            JOIN users u ON u.id = sa.user_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY sa.work_date DESC, u.name\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    // Shared by the attendance and shift lists — both filter on a date range
    // plus an optional staff member.
    private static void addRange(List<String> where, List<Object> values, String dateCol,
                                 String from, String to, Long userId, String userCol) {
        if (from != null && !from.isBlank()) {
            values.add(from);
            where.add(dateCol + " >= ?");
        }
        if (to != null && !to.isBlank()) {
            values.add(to);
            where.add(dateCol + " <= ?");
        }
        if (userId != null) {
            values.add(userId);
            where.add(userCol + " = ?");
        }
    }

    @Override
    public Map<String, Object> upsertAttendance(Long userId, String workDate, String status,
                                                String checkIn, String checkOut, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO staff_attendance (user_id, work_date, status, check_in, check_out, notes)
            VALUES (?, COALESCE(?::date, CURRENT_DATE), ?, ?::time, ?::time, ?)
            ON CONFLICT (user_id, work_date) DO UPDATE SET
               status = EXCLUDED.status,
               check_in = COALESCE(EXCLUDED.check_in, staff_attendance.check_in),
               check_out = COALESCE(EXCLUDED.check_out, staff_attendance.check_out),
               notes = COALESCE(EXCLUDED.notes, staff_attendance.notes)
            RETURNING *""",
            userId, workDate, status, checkIn, checkOut, notes);
    }

    @Override
    public Optional<Map<String, Object>> deleteAttendance(Long id) {
        return jdbc.queryForList("DELETE FROM staff_attendance WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    // ---- shifts --------------------------------------------------------------

    @Override
    public List<Map<String, Object>> findShifts(String from, String to, Long userId) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        addRange(where, values, "s.shift_date", from, to, userId, "s.user_id");
        String sql = """
            SELECT s.*, u.name AS staff_name, u.role
            FROM staff_shifts s JOIN users u ON u.id = s.user_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY s.shift_date DESC, s.start_time\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findOverlappingShift(Long userId, String shiftDate,
                                                              String startTime, String endTime) {
        // Half-open overlap: an existing shift clashes when it starts before the
        // new one ends and ends after the new one starts. Back-to-back is fine.
        return jdbc.queryForList("""
            SELECT id, start_time, end_time FROM staff_shifts
            WHERE user_id = ? AND shift_date = ?::date AND start_time < ?::time AND end_time > ?::time""",
            userId, shiftDate, endTime, startTime).stream().findFirst();
    }

    @Override
    public Map<String, Object> insertShift(Long userId, String shiftDate, String startTime,
                                           String endTime, String roleNote) {
        return jdbc.queryForMap("""
            INSERT INTO staff_shifts (user_id, shift_date, start_time, end_time, role_note)
            VALUES (?, ?::date, ?::time, ?::time, ?) RETURNING *""",
            userId, shiftDate, startTime, endTime, roleNote);
    }

    @Override
    public Optional<Map<String, Object>> deleteShift(Long id) {
        return jdbc.queryForList("DELETE FROM staff_shifts WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    // ---- payroll -------------------------------------------------------------

    @Override
    public List<Map<String, Object>> findPayroll(Integer month, Integer year) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (month != null) {
            values.add(month);
            where.add("p.period_month = ?");
        }
        if (year != null) {
            values.add(year);
            where.add("p.period_year = ?");
        }
        String sql = """
            SELECT p.*, u.name AS staff_name, u.role, u.username
            FROM payroll p JOIN users u ON u.id = p.user_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY p.period_year DESC, p.period_month DESC, u.name";
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findPayrollFor(Long userId, int month, int year) {
        return jdbc.queryForList(
            "SELECT * FROM payroll WHERE user_id = ? AND period_month = ? AND period_year = ?",
            userId, month, year).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findPayrollRow(Long id) {
        return jdbc.queryForList("""
            SELECT p.*, u.name AS staff_name FROM payroll p
            JOIN users u ON u.id = p.user_id WHERE p.id = ?""", id).stream().findFirst();
    }

    @Override
    public int countAttendanceDays(Long userId, int month, int year, List<String> statuses) {
        String placeholders = String.join(", ", java.util.Collections.nCopies(statuses.size(), "?"));
        List<Object> params = new ArrayList<>();
        params.add(userId);
        params.addAll(statuses);
        params.add(month);
        params.add(year);
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM staff_attendance"
                + " WHERE user_id = ? AND status IN (" + placeholders + ")"
                + " AND EXTRACT(MONTH FROM work_date) = ? AND EXTRACT(YEAR FROM work_date) = ?",
            Integer.class, params.toArray());
        return n == null ? 0 : n;
    }

    @Override
    public BigDecimal pendingCommission(Long userId, int month, int year) {
        BigDecimal total = jdbc.queryForObject("""
            SELECT COALESCE(SUM(amount), 0) FROM commissions
            WHERE trainer_id = ? AND status = 'pending'
              AND EXTRACT(MONTH FROM earned_on) = ? AND EXTRACT(YEAR FROM earned_on) = ?""",
            BigDecimal.class, userId, month, year);
        return total == null ? BigDecimal.ZERO : total;
    }

    @Override
    public Map<String, Object> upsertPayroll(Long userId, int month, int year, BigDecimal baseSalary,
                                             BigDecimal commission, BigDecimal netPay, int daysPresent) {
        return jdbc.queryForMap("""
            INSERT INTO payroll (user_id, period_month, period_year, base_salary, commission,
                                 deductions, net_pay, days_present, status)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?, 'draft')
            ON CONFLICT (user_id, period_month, period_year) DO UPDATE SET
               base_salary = EXCLUDED.base_salary,
               commission = EXCLUDED.commission,
               net_pay = EXCLUDED.net_pay - payroll.deductions,
               days_present = EXCLUDED.days_present
            RETURNING *""",
            userId, month, year, baseSalary, commission, netPay, daysPresent);
    }

    @Override
    public Map<String, Object> updatePayroll(Long id, BigDecimal deductions, BigDecimal netPay, String status,
                                             String method, String notes, boolean markingPaid) {
        return jdbc.queryForMap("""
            UPDATE payroll SET deductions = ?, net_pay = ?, status = COALESCE(?, status),
                               method = COALESCE(?, method), notes = COALESCE(?, notes),
                               paid_on = CASE WHEN ? THEN CURRENT_DATE ELSE paid_on END
            WHERE id = ? RETURNING *""",
            deductions, netPay, status, method, notes, markingPaid, id);
    }

    @Override
    public int settleCommissions(Long userId, int month, int year) {
        return jdbc.update("""
            UPDATE commissions SET status = 'paid', paid_on = CURRENT_DATE
            WHERE trainer_id = ? AND status = 'pending'
              AND EXTRACT(MONTH FROM earned_on) = ? AND EXTRACT(YEAR FROM earned_on) = ?""",
            userId, month, year);
    }
}
