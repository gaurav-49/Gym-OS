package com.gymos.portal.dao.impl;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.portal.dao.MemberPortalDao;

@Repository
public class MemberPortalDaoImpl implements MemberPortalDao {

    private final JdbcTemplate jdbc;

    public MemberPortalDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<Map<String, Object>> findPortalMember(Long id) {
        return jdbc.queryForList("""
            SELECT c.*, t.name AS trainer_name, COALESCE(c.amount_due, 0) AS amount_due
            FROM clients c
            LEFT JOIN users t ON t.id = c.trainer_id
            WHERE c.id = ?""", id).stream().findFirst();
    }

    @Override
    public void updateThemePreference(Long id, String theme) {
        jdbc.update("UPDATE clients SET theme_preference = ? WHERE id = ?", theme, id);
    }

    @Override
    public List<Map<String, Object>> listWorkouts(Long memberId) {
        return jdbc.queryForList("""
            SELECT day, exercise, sets, reps, weight, rest_seconds, notes
            FROM workout_plans WHERE member_id = ? ORDER BY id""", memberId);
    }

    @Override
    public List<Map<String, Object>> listDiet(Long memberId) {
        return jdbc.queryForList("""
            SELECT meal, food_item, calories, protein_g, carbs_g, fats_g, notes
            FROM diet_plans WHERE member_id = ? ORDER BY id""", memberId);
    }

    @Override
    public List<Map<String, Object>> listProgress(Long memberId, int limit) {
        return jdbc.queryForList("""
            SELECT record_date, weight, body_fat, chest, waist, arms, thighs, shoulders, notes
            FROM member_progress WHERE member_id = ?
            ORDER BY record_date DESC, id DESC LIMIT ?""", memberId, limit);
    }

    @Override
    public List<Map<String, Object>> listAttendance(Long memberId, int limit) {
        // attendance.member_id is clients.id, NOT the member_code the desk and
        // the member see. This took the code and bound it straight into the id
        // column; Postgres cast the string to an integer without complaint, so
        // every member was shown the check-in history of whichever member
        // happened to hold that number as a primary key. Member 5008 (id 4070,
        // 12 visits of their own) was served 30 rows belonging to a stranger.
        return jdbc.queryForList("""
            SELECT date, time, status, source FROM attendance
            WHERE member_id = ? ORDER BY date DESC, time DESC LIMIT ?""", memberId, limit);
    }

    @Override
    public List<Map<String, Object>> listPayments(Long memberId, int limit) {
        // id comes back because the receipt is numbered from it, and created_at
        // orders same-day payments the way they were actually taken. purpose
        // and the period come back because a receipt that has to guess what
        // the money bought prints the member's current membership over a
        // personal-training payment — which is what it used to do.
        return jdbc.queryForList("""
            SELECT id, amount, payment_date, method, note, created_at,
                   purpose, reference_id, plan_name, period_start, period_end, discount
            FROM payments
            WHERE member_id = ? ORDER BY payment_date DESC, id DESC LIMIT ?""", memberId, limit);
    }

    @Override
    public Optional<Map<String, Object>> findTrainer(Long memberId) {
        // Only what a member may see about their trainer: who they are and how
        // to reach them. No password hash, no role, no salary.
        return jdbc.queryForList("""
            SELECT t.id, t.name, t.email, t.phone
            FROM clients c JOIN users t ON t.id = c.trainer_id
            WHERE c.id = ?""", memberId).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> listPtSubscriptions(Long memberId) {
        return jdbc.queryForList("""
            SELECT s.id, s.sessions_total, s.sessions_used, s.price, s.start_date,
                   s.expiry_date, s.status, p.name AS package_name, p.plan_type,
                   p.validity_days, t.name AS trainer_name
            FROM pt_subscriptions s
            JOIN pt_packages p ON p.id = s.package_id
            LEFT JOIN users t ON t.id = s.trainer_id
            WHERE s.member_id = ?
            ORDER BY s.start_date DESC, s.id DESC""", memberId);
    }

    @Override
    public List<Map<String, Object>> listPtSessions(Long memberId, int limit) {
        return jdbc.queryForList("""
            SELECT ps.session_date, ps.session_time, ps.notes, s.id AS subscription_id,
                   t.name AS trainer_name, p.name AS package_name, p.plan_type
            FROM pt_sessions ps
            JOIN pt_subscriptions s ON s.id = ps.subscription_id
            JOIN pt_packages p ON p.id = s.package_id
            LEFT JOIN users t ON t.id = ps.trainer_id
            WHERE s.member_id = ?
            ORDER BY ps.session_date DESC, ps.id DESC
            LIMIT ?""", memberId, limit);
    }

    @Override
    public Optional<Map<String, Object>> findLocker(Long memberId) {
        return jdbc.queryForList("""
            SELECT id, locker_number, location, size, monthly_rent, status,
                   assigned_from, assigned_until
            FROM lockers WHERE member_id = ?
            ORDER BY id LIMIT 1""", memberId).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> listInvoices(Long memberId, int limit) {
        List<Map<String, Object>> invoices = jdbc.queryForList("""
            SELECT i.id, i.invoice_no, i.invoice_date, i.subtotal, i.tax_amount, i.total,
                   i.status, i.method, i.notes, b.name AS branch_name, b.address AS branch_address,
                   b.gst_number AS branch_gst
            FROM invoices i
            LEFT JOIN branches b ON b.id = i.branch_id
            WHERE i.member_id = ?
            ORDER BY i.invoice_date DESC, i.id DESC LIMIT ?""", memberId, limit);
        // The lines come with them: an invoice the member cannot open in full
        // is a number, not a document.
        for (Map<String, Object> invoice : invoices) {
            invoice.put("items", jdbc.queryForList("""
                SELECT description, hsn_sac, quantity, unit_price, tax_rate, tax_amount, line_total
                FROM invoice_items WHERE invoice_id = ? ORDER BY id""", invoice.get("id")));
        }
        return invoices;
    }

    @Override
    public void setPassword(Long memberId, String passwordHash) {
        jdbc.update("""
            UPDATE clients
            SET password_hash = ?, password_set_at = NOW(), must_reset_password = FALSE
            WHERE id = ?""", passwordHash, memberId);
    }

    @Override
    public void setMustResetPassword(Long memberId, boolean mustReset) {
        jdbc.update("UPDATE clients SET must_reset_password = ? WHERE id = ?", mustReset, memberId);
    }
}
