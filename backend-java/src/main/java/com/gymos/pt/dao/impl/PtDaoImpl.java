package com.gymos.pt.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.pt.dao.PtDao;

@Repository
public class PtDaoImpl implements PtDao {

    private static final int LIST_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public PtDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- packages ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> findPackages(boolean activeOnly) {
        return jdbc.queryForList("""
            SELECT p.*,
                   (SELECT COUNT(*)::int FROM pt_subscriptions s
                     WHERE s.package_id = p.id AND s.status = 'active') AS active_subscriptions
            FROM pt_packages p"""
            + (activeOnly ? "\nWHERE p.is_active = TRUE" : "")
            + "\nORDER BY p.sessions, p.name");
    }

    @Override
    public Optional<Map<String, Object>> findPackageById(Long id) {
        return jdbc.queryForList("SELECT * FROM pt_packages WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findPackageByName(String name) {
        return jdbc.queryForList("SELECT id FROM pt_packages WHERE LOWER(name) = LOWER(?)", name)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insertPackage(String name, String planType, Integer sessions, BigDecimal price,
                                             int validityDays, BigDecimal commissionPercent) {
        return jdbc.queryForMap("""
            INSERT INTO pt_packages (name, plan_type, sessions, price, validity_days, trainer_commission_percent)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING *""",
            name, planType, sessions, price, validityDays, commissionPercent);
    }

    @Override
    public Optional<Map<String, Object>> updatePackage(Long id, String name, String planType, Integer sessions,
                                                       BigDecimal price, Integer validityDays,
                                                       BigDecimal commissionPercent, Boolean isActive) {
        return jdbc.queryForList("""
            UPDATE pt_packages SET
                name = COALESCE(?, name), plan_type = COALESCE(?, plan_type),
                sessions = COALESCE(?, sessions), price = COALESCE(?, price),
                validity_days = COALESCE(?, validity_days),
                trainer_commission_percent = COALESCE(?, trainer_commission_percent),
                is_active = COALESCE(?, is_active)
            WHERE id = ? RETURNING *""",
            name, planType, sessions, price, validityDays, commissionPercent, isActive, id)
            .stream().findFirst();
    }

    @Override
    public void deletePackage(Long id) {
        jdbc.update("DELETE FROM pt_packages WHERE id = ?", id);
    }

    @Override
    public int countSubscriptionsOf(Long packageId) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM pt_subscriptions WHERE package_id = ?", Integer.class, packageId);
        return n == null ? 0 : n;
    }

    // ---- subscriptions -------------------------------------------------------

    @Override
    public List<Map<String, Object>> findSubscriptions(Long memberId, Long trainerId, String status) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (memberId != null) {
            values.add(memberId);
            where.add("s.member_id = ?");
        }
        if (trainerId != null) {
            values.add(trainerId);
            where.add("s.trainer_id = ?");
        }
        if (status != null && !status.isBlank()) {
            values.add(status);
            where.add("s.status = ?");
        }
        // sessions_left and is_expired are derived here so the list, the member
        // page and the trainer's view can never disagree.
        String sql = """
            SELECT s.*, c.name AS member_name, c.member_code, p.name AS package_name,
                   t.name AS trainer_name,
                   -- NULL sessions_total is an unlimited plan; the subtraction
                   -- would yield NULL and the UI would render it as NaN.
                   CASE WHEN s.sessions_total IS NULL THEN NULL
                        ELSE GREATEST(0, s.sessions_total - s.sessions_used) END AS sessions_left,
                   p.plan_type,
                   -- The term is what was sold, so the term is what the desk
                   -- sees: how long it runs and how much of it is left.
                   GREATEST(0, s.expiry_date - CURRENT_DATE) AS days_left,
                   GREATEST(1, s.expiry_date - s.start_date) AS term_days,
                   (s.expiry_date IS NOT NULL AND s.expiry_date < CURRENT_DATE) AS is_expired
            FROM pt_subscriptions s
            JOIN clients c ON c.id = s.member_id
            JOIN pt_packages p ON p.id = s.package_id
            LEFT JOIN users t ON t.id = s.trainer_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY s.status, s.start_date DESC, s.id DESC\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> lockSubscription(Long id) {
        // FOR UPDATE OF s locks only the subscription row — the joined member and
        // package rows are read-only here and must not be held.
        return jdbc.queryForList("""
            SELECT s.*, c.name AS member_name, p.name AS package_name
            FROM pt_subscriptions s
            JOIN clients c ON c.id = s.member_id
            JOIN pt_packages p ON p.id = s.package_id
            WHERE s.id = ? FOR UPDATE OF s""", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findSubscriptionById(Long id) {
        return jdbc.queryForList("SELECT * FROM pt_subscriptions WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findActiveSubscription(Long memberId) {
        return jdbc.queryForList(
            "SELECT id FROM pt_subscriptions WHERE member_id = ? AND status = 'active'", memberId)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insertSubscription(Long memberId, Long packageId, Long trainerId,
                                          // Integer, not int: null is an unlimited plan, and
                                          // unboxing it threw before the row was ever written.
                                          Integer sessionsTotal,
                                                  BigDecimal price, String startDate, String expiryDate) {
        return jdbc.queryForMap("""
            INSERT INTO pt_subscriptions (member_id, package_id, trainer_id, sessions_total, price,
                                          start_date, expiry_date)
            VALUES (?, ?, ?, ?, ?, ?::date, ?::date) RETURNING *""",
            memberId, packageId, trainerId, sessionsTotal, price, startDate, expiryDate);
    }

    @Override
    public Map<String, Object> updateSubscription(Long id, String status, Long trainerId) {
        return jdbc.queryForMap("""
            UPDATE pt_subscriptions SET status = COALESCE(?, status), trainer_id = COALESCE(?, trainer_id)
            WHERE id = ? RETURNING *""", status, trainerId, id);
    }

    @Override
    public Map<String, Object> setSessionsUsed(Long id, int sessionsUsed, String status) {
        return jdbc.queryForMap(
            "UPDATE pt_subscriptions SET sessions_used = ?, status = ? WHERE id = ? RETURNING *",
            sessionsUsed, status, id);
    }

    // ---- sessions ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> findSessions(Long subscriptionId) {
        return jdbc.queryForList("""
            SELECT s.*, u.name AS trainer_name FROM pt_sessions s
            LEFT JOIN users u ON u.id = s.trainer_id
            WHERE s.subscription_id = ?
            ORDER BY s.session_date DESC, s.id DESC""", subscriptionId);
    }

    @Override
    public Map<String, Object> insertSession(Long subscriptionId, Long trainerId, String sessionDate,
                                             String sessionTime, String notes) {
        return jdbc.queryForMap("""
            INSERT INTO pt_sessions (subscription_id, trainer_id, session_date, session_time, notes)
            VALUES (?, ?, COALESCE(?::date, CURRENT_DATE), ?::time, ?) RETURNING *""",
            subscriptionId, trainerId, sessionDate, sessionTime, notes);
    }

    // ---- money ---------------------------------------------------------------

    @Override
    public void insertPayment(Long memberId, BigDecimal amount, String paymentDate, String method, String note,
                              Long subscriptionId, String planName, String periodStart, String periodEnd) {
        jdbc.update("""
            INSERT INTO payments (member_id, amount, payment_date, method, note,
                                  purpose, reference_id, plan_name, period_start, period_end)
            VALUES (?, ?, ?::date, ?, ?, 'pt', ?, ?, ?::date, ?::date)""",
            memberId, amount, paymentDate, method, note,
            subscriptionId, planName, periodStart, periodEnd);
    }

    @Override
    public Map<String, Object> insertCommission(Long trainerId, Long subscriptionId, Long memberId,
                                                BigDecimal baseAmount, BigDecimal percent, BigDecimal amount,
                                                String earnedOn) {
        return jdbc.queryForMap("""
            INSERT INTO commissions (trainer_id, source, source_id, member_id, base_amount, percent,
                                     amount, earned_on)
            VALUES (?, 'pt_package', ?, ?, ?, ?, ?, ?::date) RETURNING *""",
            trainerId, subscriptionId, memberId, baseAmount, percent, amount, earnedOn);
    }

    @Override
    public List<Map<String, Object>> findCommissions(Long trainerId, String status) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (trainerId != null) {
            values.add(trainerId);
            where.add("cm.trainer_id = ?");
        }
        if (status != null && !status.isBlank()) {
            values.add(status);
            where.add("cm.status = ?");
        }
        String sql = """
            SELECT cm.*, u.name AS trainer_name, c.name AS member_name, c.member_code
            FROM commissions cm
            JOIN users u ON u.id = cm.trainer_id
            LEFT JOIN clients c ON c.id = cm.member_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY cm.status, cm.earned_on DESC, cm.id DESC\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    // ---- lookups -------------------------------------------------------------

    @Override
    public Optional<Map<String, Object>> findMember(Long memberId) {
        return jdbc.queryForList("SELECT id, name, member_code, status FROM clients WHERE id = ?", memberId)
            .stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findTrainer(Long trainerId) {
        return jdbc.queryForList("SELECT id, name, role FROM users WHERE id = ?", trainerId)
            .stream().findFirst();
    }
}
