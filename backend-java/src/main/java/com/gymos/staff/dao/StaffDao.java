package com.gymos.staff.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Staff directory, attendance, shift roster and payroll. */
public interface StaffDao {

    /** Every user account with its employment terms and today's status. */
    List<Map<String, Object>> findStaff();

    Optional<Map<String, Object>> findUser(Long id);

    Optional<Map<String, Object>> updateEmployment(Long id, BigDecimal monthlySalary,
                                                   BigDecimal commissionPercent, String joinedOn);

    // ---- attendance ----

    List<Map<String, Object>> findAttendance(String from, String to, Long userId);

    /** Upsert on (user_id, work_date): re-posting a day corrects it rather than failing. */
    Map<String, Object> upsertAttendance(Long userId, String workDate, String status,
                                         String checkIn, String checkOut, String notes);

    Optional<Map<String, Object>> deleteAttendance(Long id);

    // ---- shifts ----

    List<Map<String, Object>> findShifts(String from, String to, Long userId);

    /** A shift for the same person that overlaps the given window. */
    Optional<Map<String, Object>> findOverlappingShift(Long userId, String shiftDate,
                                                       String startTime, String endTime);

    Map<String, Object> insertShift(Long userId, String shiftDate, String startTime,
                                    String endTime, String roleNote);

    Optional<Map<String, Object>> deleteShift(Long id);

    // ---- payroll ----

    List<Map<String, Object>> findPayroll(Integer month, Integer year);

    Optional<Map<String, Object>> findPayrollFor(Long userId, int month, int year);

    Optional<Map<String, Object>> findPayrollRow(Long id);

    /** Days with the given statuses in one month — the pro-rating input. */
    int countAttendanceDays(Long userId, int month, int year, List<String> statuses);

    /** Pending commissions a trainer earned in that month. */
    BigDecimal pendingCommission(Long userId, int month, int year);

    Map<String, Object> upsertPayroll(Long userId, int month, int year, BigDecimal baseSalary,
                                      BigDecimal commission, BigDecimal netPay, int daysPresent);

    Map<String, Object> updatePayroll(Long id, BigDecimal deductions, BigDecimal netPay, String status,
                                      String method, String notes, boolean markingPaid);

    /** Settles the commissions a paid payroll row included, so they cannot be paid twice. */
    int settleCommissions(Long userId, int month, int year);
}
