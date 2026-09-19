package com.gymos.staff.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.staff.dao.StaffDao;
import com.gymos.staff.service.StaffService;

@Service
public class StaffServiceImpl implements StaffService {

    private static final List<String> ATTENDANCE_STATUSES =
        List.of("Present", "Absent", "Half-day", "Leave", "Holiday");
    private static final List<String> PAYROLL_STATUSES = List.of("draft", "approved", "paid");

    /** A working month, for pro-rating a monthly salary from days present. */
    private static final BigDecimal WORKING_DAYS = BigDecimal.valueOf(26);

    private final StaffDao staffDao;
    private final AuditService audit;

    public StaffServiceImpl(StaffDao staffDao, AuditService audit) {
        this.staffDao = staffDao;
        this.audit = audit;
    }

    // ---- directory -----------------------------------------------------------

    @Override
    public List<Map<String, Object>> listStaff() {
        return staffDao.findStaff();
    }

    @Override
    public Map<String, Object> updateEmployment(Long id, Map<String, Object> body) {
        BigDecimal salary = optionalDecimal(body, "monthly_salary");
        if (salary != null && salary.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "monthly_salary must be a non-negative number");
        }
        BigDecimal percent = optionalDecimal(body, "commission_percent");
        if (percent != null && (percent.signum() < 0 || percent.compareTo(BigDecimal.valueOf(100)) > 0)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "commission_percent must be between 0 and 100");
        }
        String joinedOn = Body.str(body, "joined_on");
        requireDate("joined_on", joinedOn);

        Map<String, Object> updated = staffDao.updateEmployment(id, salary, percent, blankToNull(joinedOn))
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Staff member not found"));
        audit.record("update", "staff", id, "Updated employment terms for " + updated.get("name"));
        return updated;
    }

    // ---- attendance ----------------------------------------------------------

    @Override
    public List<Map<String, Object>> listAttendance(String from, String to, Long userId) {
        requireDate("from", from);
        requireDate("to", to);
        return staffDao.findAttendance(from, to, userId);
    }

    @Override
    public Map<String, Object> markAttendance(Map<String, Object> body) {
        Long userId = Body.toLong(body.get("user_id"));
        if (userId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "user_id is required");
        }
        String status = Body.str(body, "status");
        if (status != null && !status.isBlank() && !ATTENDANCE_STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", ATTENDANCE_STATUSES));
        }
        String workDate = Body.str(body, "work_date");
        requireDate("work_date", workDate);
        // A shift is a record of work already done. A date decades ahead is a
        // typed year, and it lands in payroll for a period that does not exist.
        String workFuture = Dates.futureError("work date", workDate);
        if (workFuture != null) throw new BusinessException(HttpStatus.BAD_REQUEST, workFuture);

        // Checking out before checking in produces a negative shift, which the
        // hours total then subtracts from everybody else's.
        String checkIn = blankToNull(Body.str(body, "check_in"));
        String checkOut = blankToNull(Body.str(body, "check_out"));
        if (checkIn != null && checkOut != null && checkOut.compareTo(checkIn) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Check-out (" + checkOut + ") cannot be before check-in (" + checkIn + ").")
                ;
        }

        Map<String, Object> staff = staffDao.findUser(userId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Staff member not found"));

        Map<String, Object> record = staffDao.upsertAttendance(userId, blankToNull(workDate),
            status == null || status.isBlank() ? "Present" : status,
            checkIn, checkOut,
            Body.str(body, "notes"));

        audit.record("mark", "staff", userId,
            staff.get("name") + " marked " + record.get("status") + " on " + record.get("work_date"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", staff.get("name") + " marked " + record.get("status")
            + " for " + record.get("work_date") + ".");
        out.put("record", record);
        return out;
    }

    @Override
    public Map<String, Object> deleteAttendance(Long id) {
        Map<String, Object> record = staffDao.deleteAttendance(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Attendance record not found"));
        audit.record("delete", "staff", id, "Removed staff attendance #" + id);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Attendance record removed.");
        out.put("record", record);
        return out;
    }

    // ---- shifts --------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listShifts(String from, String to, Long userId) {
        requireDate("from", from);
        requireDate("to", to);
        return staffDao.findShifts(from, to, userId);
    }

    @Override
    public Map<String, Object> createShift(Map<String, Object> body) {
        Long userId = Body.toLong(body.get("user_id"));
        if (userId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "user_id is required");
        }
        String shiftDate = Body.str(body, "shift_date");
        if (shiftDate == null || shiftDate.isBlank() || !Dates.isValidDateString(shiftDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "shift_date must be a valid date in YYYY-MM-DD format");
        }
        String startTime = Body.str(body, "start_time");
        String endTime = Body.str(body, "end_time");
        if (startTime == null || startTime.isBlank() || endTime == null || endTime.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "start_time and end_time are required");
        }
        // Lexicographic compare is correct for zero-padded HH:mm / HH:mm:ss.
        if (endTime.compareTo(startTime) <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "end_time must be after start_time");
        }

        Map<String, Object> staff = staffDao.findUser(userId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Staff member not found"));

        // Two overlapping shifts mean somebody is rostered in two places at once.
        staffDao.findOverlappingShift(userId, shiftDate, startTime, endTime).ifPresent(clash -> {
            throw new BusinessException(HttpStatus.CONFLICT,
                staff.get("name") + " already has a shift from " + clash.get("start_time")
                    + " to " + clash.get("end_time") + " that day.");
        });

        Map<String, Object> shift = staffDao.insertShift(userId, shiftDate, startTime, endTime,
            Body.str(body, "role_note"));
        audit.record("create", "staff", shift.get("id"),
            "Rostered " + staff.get("name") + " on " + shiftDate + " " + startTime + "–" + endTime);
        return shift;
    }

    @Override
    public Map<String, Object> deleteShift(Long id) {
        Map<String, Object> shift = staffDao.deleteShift(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Shift not found"));
        audit.record("delete", "staff", id, "Removed shift #" + id);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Shift removed.");
        out.put("shift", shift);
        return out;
    }

    // ---- payroll -------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listPayroll(String monthRaw, String yearRaw) {
        Integer month = parsePeriod(monthRaw, "month", 1, 12);
        Integer year = parsePeriod(yearRaw, "year", 2000, 2100);
        return staffDao.findPayroll(month, year);
    }

    @Override
    public Map<String, Object> generatePayroll(Map<String, Object> body) {
        Integer month = parsePeriod(String.valueOf(body.get("month")), "month", 1, 12);
        Integer year = parsePeriod(String.valueOf(body.get("year")), "year", 2000, 2100);
        if (month == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "month must be between 1 and 12");
        }
        if (year == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "year must be between 2000 and 2100");
        }

        int generated = 0;
        int skipped = 0;
        for (Map<String, Object> person : staffDao.findStaff()) {
            Long userId = Body.toLong(person.get("id"));

            // A paid row is history — refreshing it would rewrite what was
            // actually handed over, so a mid-month preview leaves it alone.
            var existing = staffDao.findPayrollFor(userId, month, year);
            if (existing.isPresent() && "paid".equals(String.valueOf(existing.get().get("status")))) {
                skipped++;
                continue;
            }

            BigDecimal monthlySalary = decimalOf(person.get("monthly_salary"));
            int daysPresent = staffDao.countAttendanceDays(userId, month, year, List.of("Present", "Holiday"));
            int halfDays = staffDao.countAttendanceDays(userId, month, year, List.of("Half-day"));
            BigDecimal commission = staffDao.pendingCommission(userId, month, year);

            BigDecimal effectiveDays = BigDecimal.valueOf(daysPresent)
                .add(BigDecimal.valueOf(halfDays).multiply(BigDecimal.valueOf(0.5)));

            // No attendance recorded at all → pay the full salary rather than
            // zero: a gym that does not track staff attendance still runs payroll.
            BigDecimal base;
            if (effectiveDays.signum() > 0) {
                BigDecimal ratio = effectiveDays.divide(WORKING_DAYS, 6, RoundingMode.HALF_UP);
                if (ratio.compareTo(BigDecimal.ONE) > 0) {
                    ratio = BigDecimal.ONE;
                }
                base = monthlySalary.multiply(ratio).setScale(2, RoundingMode.HALF_UP);
            } else {
                base = monthlySalary.setScale(2, RoundingMode.HALF_UP);
            }
            BigDecimal net = base.add(commission).setScale(2, RoundingMode.HALF_UP);

            staffDao.upsertPayroll(userId, month, year, base, commission, net, daysPresent);
            generated++;
        }

        audit.record("generate", "staff", null,
            "Generated payroll for " + month + "/" + year + " — " + generated + " draft(s)");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Payroll drafted for " + generated + " staff member(s) for " + month + "/" + year + "."
            + (skipped > 0 ? " " + skipped + " already-paid row(s) left untouched." : ""));
        out.put("generated", generated);
        out.put("skipped", skipped);
        return out;
    }

    @Override
    public Map<String, Object> updatePayroll(Long id, Map<String, Object> body) {
        BigDecimal deductions = optionalDecimal(body, "deductions");
        if (deductions != null && deductions.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "deductions must be a non-negative number");
        }
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        if (status != null && !PAYROLL_STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", PAYROLL_STATUSES));
        }
        String method = body.containsKey("method") ? Body.str(body, "method") : null;
        if (method != null && !PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        Map<String, Object> existing = staffDao.findPayrollRow(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Payroll row not found"));
        String staffName = String.valueOf(existing.get("staff_name"));
        Object period = existing.get("period_month") + "/" + existing.get("period_year");
        boolean alreadyPaid = "paid".equals(String.valueOf(existing.get("status")));

        if (alreadyPaid && status != null && !"paid".equals(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                staffName + "'s " + period + " payroll is already paid and cannot be reopened.");
        }

        BigDecimal nextDeductions = deductions != null ? deductions : decimalOf(existing.get("deductions"));
        BigDecimal nextNet = decimalOf(existing.get("base_salary"))
            .add(decimalOf(existing.get("commission")))
            .subtract(nextDeductions)
            .setScale(2, RoundingMode.HALF_UP);
        if (nextNet.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Deductions cannot exceed salary plus commission.");
        }

        boolean markingPaid = "paid".equals(status) && !alreadyPaid;
        Map<String, Object> updated = staffDao.updatePayroll(id, nextDeductions, nextNet, status, method,
            body.containsKey("notes") ? Body.str(body, "notes") : null, markingPaid);

        // Paying payroll settles the commissions it included, so the same
        // earnings can never be paid out twice.
        if (markingPaid) {
            staffDao.settleCommissions(Body.toLong(existing.get("user_id")),
                Body.toInt(existing.get("period_month")), Body.toInt(existing.get("period_year")));
        }
        audit.record(markingPaid ? "pay" : "update", "staff", id,
            staffName + " payroll " + period + " → " + updated.get("status")
                + " (₹" + updated.get("net_pay") + ")");
        return updated;
    }

    // ---- helpers -------------------------------------------------------------

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    private static BigDecimal optionalDecimal(Map<String, Object> body, String key) {
        Object raw = body.get(key);
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        BigDecimal value = Body.toDecimal(raw);
        if (value == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, key + " must be a number");
        }
        return value;
    }

    private static BigDecimal decimalOf(Object v) {
        BigDecimal d = Body.toDecimal(v);
        return d == null ? BigDecimal.ZERO : d;
    }

    /** @return null when absent; throws when present but out of range. */
    private static Integer parsePeriod(String raw, String field, int min, int max) {
        if (raw == null || raw.isBlank() || "null".equals(raw)) {
            return null;
        }
        int value;
        try {
            value = Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            return null;
        }
        if (value < min || value > max) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be between " + min + " and " + max);
        }
        return value;
    }
}
