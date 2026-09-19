package com.gymos.plans.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.plans.dao.PlanDao;

@Repository
public class PlanDaoImpl implements PlanDao {

    private final JdbcTemplate jdbc;

    public PlanDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // Correlated counts rather than a join so a plan with no members still
    // appears, with a zero.
    //
    // TWO counts, because the screen needs both and used to show one while the
    // server enforced the other: the chip counted active members (108) and the
    // delete guard counted every client row referencing the plan (204), so an
    // admin saw an enabled delete button and a refusal quoting a number that
    // appeared nowhere on the page. total_members is the one deletion is
    // judged on — an expired member still points at the plan.
    private static final String PLAN_SELECT = """
        SELECT p.*,
               (SELECT COUNT(*)::int FROM clients c
                 WHERE c.membership_type = p.name AND c.status = 'active') AS active_members,
               (SELECT COUNT(*)::int FROM clients c
                 WHERE c.membership_type = p.name) AS total_members
        FROM plans p""";

    @Override
    public List<Map<String, Object>> findPlans(boolean activeOnly) {
        String sql = PLAN_SELECT
            + (activeOnly ? " WHERE p.is_active = TRUE" : "")
            + " ORDER BY p.sort_order, p.id";
        return jdbc.queryForList(sql);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM plans WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findByName(String name) {
        return jdbc.queryForList("SELECT * FROM plans WHERE LOWER(name) = LOWER(?)", name.trim())
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String name, int durationDays, BigDecimal price, BigDecimal signupFee,
                                      String description, int sortOrder, boolean isActive) {
        return jdbc.queryForMap("""
            INSERT INTO plans (name, duration_days, price, signup_fee, description, sort_order, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            name, durationDays, price, signupFee, description, sortOrder, isActive);
    }

    @Override
    public Map<String, Object> update(Long id, String name, Integer durationDays, BigDecimal price,
                                      BigDecimal signupFee, String description, Integer sortOrder,
                                      Boolean isActive) {
        return jdbc.queryForMap("""
            UPDATE plans SET
                name = COALESCE(?, name),
                duration_days = COALESCE(?, duration_days),
                price = COALESCE(?, price),
                signup_fee = COALESCE(?, signup_fee),
                description = COALESCE(?, description),
                sort_order = COALESCE(?, sort_order),
                is_active = COALESCE(?, is_active)
            WHERE id = ? RETURNING *""",
            name, durationDays, price, signupFee, description, sortOrder, isActive, id);
    }

    @Override
    public void delete(Long id) {
        jdbc.update("DELETE FROM plans WHERE id = ?", id);
    }

    @Override
    public int countMembersOn(String planName) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM clients WHERE membership_type = ?", Integer.class, planName);
        return n == null ? 0 : n;
    }

    @Override
    public int countActiveMembersOn(String planName) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM clients WHERE membership_type = ? AND status = 'active'",
            Integer.class, planName);
        return n == null ? 0 : n;
    }
}
