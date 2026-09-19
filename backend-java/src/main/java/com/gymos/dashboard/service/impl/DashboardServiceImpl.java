package com.gymos.dashboard.service.impl;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.gymos.dashboard.dao.DashboardDao;
import com.gymos.dashboard.service.DashboardService;
import com.gymos.payment.dao.PaymentDao;

/**
 * Dashboard service — the same 12 aggregations as dashboardController.js. The
 * ledger totals reuse the payments module's DAO (common code), everything else
 * comes from the dashboard DAO.
 */
@Service
public class DashboardServiceImpl implements DashboardService {

    private final DashboardDao dashboardDao;
    private final PaymentDao paymentDao;

    public DashboardServiceImpl(DashboardDao dashboardDao, PaymentDao paymentDao) {
        this.dashboardDao = dashboardDao;
        this.paymentDao = paymentDao;
    }

    @Override
    public Map<String, Object> stats() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total_members", dashboardDao.countAll());
        out.put("active_members", dashboardDao.countActive());
        out.put("expired_members", dashboardDao.countExpired());
        out.put("expiring_soon", dashboardDao.countExpiringSoon());
        out.put("present_today", dashboardDao.countPresentToday());
        out.put("today_collection", paymentDao.sumToday());
        out.put("month_collection", paymentDao.sumMonth());
        out.put("recent_attendance", dashboardDao.recentAttendance());
        out.put("expiring_list", dashboardDao.expiringList());
        out.put("new_members", dashboardDao.newMembers());
        out.put("weekly_attendance", dashboardDao.weeklyAttendance());
        out.put("monthly_revenue", dashboardDao.monthlyRevenue());
        return out;
    }
}
