package com.gymos.dashboard.service;

import java.util.Map;

/**
 * Dashboard service — assembles the GET /api/dashboard/stats payload.
 */
public interface DashboardService {

    Map<String, Object> stats();
}
