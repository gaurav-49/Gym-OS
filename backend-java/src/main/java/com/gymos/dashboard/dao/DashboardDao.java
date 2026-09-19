package com.gymos.dashboard.dao;

import java.util.List;
import java.util.Map;

/**
 * Dashboard data access — the aggregate queries behind GET /api/dashboard/stats.
 * All SQL lives in {@link com.gymos.dashboard.dao.impl.DashboardDaoImpl}.
 */
public interface DashboardDao {

    int countAll();

    int countActive();

    int countExpired();

    int countExpiringSoon();

    int countPresentToday();

    List<Map<String, Object>> recentAttendance();

    List<Map<String, Object>> expiringList();

    List<Map<String, Object>> newMembers();

    List<Map<String, Object>> weeklyAttendance();

    List<Map<String, Object>> monthlyRevenue();
}
