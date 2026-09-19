package com.gymos.staff.service;

import java.util.List;
import java.util.Map;

/**
 * Staff operations: employee attendance, shift rosters and monthly payroll.
 *
 * <p>Members had all three in 1.0; employees had none. Payroll is generated from
 * the staff member's own attendance plus their pending trainer commissions, so a
 * run is reproducible rather than typed in by hand.
 */
public interface StaffService {

    List<Map<String, Object>> listStaff();

    Map<String, Object> updateEmployment(Long id, Map<String, Object> body);

    List<Map<String, Object>> listAttendance(String from, String to, Long userId);

    Map<String, Object> markAttendance(Map<String, Object> body);

    Map<String, Object> deleteAttendance(Long id);

    List<Map<String, Object>> listShifts(String from, String to, Long userId);

    Map<String, Object> createShift(Map<String, Object> body);

    Map<String, Object> deleteShift(Long id);

    List<Map<String, Object>> listPayroll(String month, String year);

    /** Drafts a row per staff member. Already-paid rows are left untouched. */
    Map<String, Object> generatePayroll(Map<String, Object> body);

    Map<String, Object> updatePayroll(Long id, Map<String, Object> body);
}
