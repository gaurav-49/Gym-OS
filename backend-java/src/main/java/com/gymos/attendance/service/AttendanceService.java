package com.gymos.attendance.service;

import java.util.List;
import java.util.Map;

/**
 * Attendance service — port of attendanceService.js: member lookup, gate rules
 * and duplicate prevention. Both the manual form and device/QR punches go
 * through {@link #mark(String, String, String, String, String, String, Map)}.
 */
public interface AttendanceService {

    Map<String, Object> mark(String memberId, String memberName, String date, String time,
                             String status, String source, Map<String, Object> member);

    List<Map<String, Object>> findAll();

    List<Map<String, Object>> report(String from, String to, String memberId, String status, String source);
}
