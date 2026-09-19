package com.gymos.dashboard.dao.impl;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.dashboard.dao.DashboardDao;

@Repository
public class DashboardDaoImpl implements DashboardDao {

    private final JdbcTemplate jdbc;

    public DashboardDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public int countAll() {
        return jdbc.queryForObject("SELECT COUNT(*)::int AS n FROM clients", Integer.class);
    }

    @Override
    public int countActive() {
        return jdbc.queryForObject("SELECT COUNT(*)::int AS n FROM clients WHERE status = 'active'", Integer.class);
    }

    @Override
    public int countExpired() {
        return jdbc.queryForObject(
            "SELECT COUNT(*)::int AS n FROM clients WHERE status = 'active' AND membership_expiry < CURRENT_DATE",
            Integer.class);
    }

    @Override
    public int countExpiringSoon() {
        return jdbc.queryForObject(
            "SELECT COUNT(*)::int AS n FROM clients WHERE status = 'active'"
                + " AND membership_expiry >= CURRENT_DATE AND membership_expiry <= (CURRENT_DATE + INTERVAL '30 days')",
            Integer.class);
    }

    @Override
    public int countPresentToday() {
        return jdbc.queryForObject(
            "SELECT COUNT(*)::int AS n FROM attendance WHERE date = CURRENT_DATE AND status = 'Present'",
            Integer.class);
    }

    @Override
    public List<Map<String, Object>> recentAttendance() {
        return jdbc.queryForList("""
            SELECT a.*, c.name AS member_name_full
            FROM attendance a
            LEFT JOIN clients c ON c.member_code = a.member_id::text
            ORDER BY a.id DESC LIMIT 10""");
    }

    @Override
    public List<Map<String, Object>> expiringList() {
        return jdbc.queryForList("""
            SELECT id, name, membership_expiry
            FROM clients
            WHERE status = 'active' AND membership_expiry >= CURRENT_DATE
              AND membership_expiry <= (CURRENT_DATE + INTERVAL '30 days')
            ORDER BY membership_expiry LIMIT 10""");
    }

    @Override
    public List<Map<String, Object>> newMembers() {
        return jdbc.queryForList("""
            SELECT id, name, join_date
            FROM clients
            WHERE join_date >= date_trunc('month', CURRENT_DATE)
            ORDER BY join_date DESC LIMIT 10""");
    }

    @Override
    public List<Map<String, Object>> weeklyAttendance() {
        return jdbc.queryForList("""
            SELECT to_char(date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
            FROM attendance WHERE date >= CURRENT_DATE - 6
            GROUP BY date ORDER BY date""");
    }

    @Override
    public List<Map<String, Object>> monthlyRevenue() {
        return jdbc.queryForList("""
            SELECT to_char(date_trunc('month', payment_date), 'YYYY-MM') AS month, SUM(amount)::float AS total
            FROM payments
            WHERE payment_date >= date_trunc('month', CURRENT_DATE - INTERVAL '5 months')
            GROUP BY 1 ORDER BY 1""");
    }
}
