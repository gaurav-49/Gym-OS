package com.gymos.attendance.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Attendance data access. All SQL lives in
 * {@link com.gymos.attendance.dao.impl.AttendanceDaoImpl}.
 */
public interface AttendanceDao {

    List<Map<String, Object>> findAll();

    List<Map<String, Object>> report(String from, String to, String memberId, String status, String source);

    Optional<Map<String, Object>> findByMemberAndDate(String memberId, String date);

    Map<String, Object> insert(String memberId, String memberName, String date, String time, String status, String source);
}
