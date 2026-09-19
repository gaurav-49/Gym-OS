package com.gymos.payment.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.payment.dao.PaymentContext;
import com.gymos.payment.dao.PaymentDao;

/**
 * Payment DAO implementation — the SQL for the payments module (and the ledger
 * writes used by member onboarding/renewal/upgrade) lives here.
 */
@Repository
public class PaymentDaoImpl implements PaymentDao {

    private final JdbcTemplate jdbc;

    public PaymentDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String INSERT = """
        INSERT INTO payments (member_id, amount, payment_date, method, note,
                              purpose, reference_id, plan_name, period_start, period_end, discount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?::date, ?) RETURNING *""";

    // The member's own details ride along so the desk can reprint a receipt
    // from this list without a second round trip — a member standing at the
    // counter asking for last month's receipt is the whole use case.
    @Override
    public List<Map<String, Object>> findAll(Long memberId) {
        String sql = """
            SELECT p.*, c.name AS member_name, c.member_code, c.phone AS member_phone,
                   c.membership_type, COALESCE(c.amount_due, 0) AS member_amount_due
            FROM payments p
            LEFT JOIN clients c ON c.id = p.member_id
            %s
            ORDER BY p.payment_date DESC, p.id DESC""".formatted(memberId != null ? "WHERE p.member_id = ?" : "");
        return memberId != null ? jdbc.queryForList(sql, memberId) : jdbc.queryForList(sql);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT id FROM payments WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(Long memberId, BigDecimal amount, String paymentDate, String method,
                                      String note, PaymentContext context) {
        PaymentContext ctx = context == null ? PaymentContext.other() : context;
        return jdbc.queryForMap(INSERT, memberId, amount, paymentDate, method, note,
            ctx.purpose(), ctx.referenceId(), ctx.planName(), ctx.periodStart(), ctx.periodEnd(),
            ctx.discount() == null ? BigDecimal.ZERO : ctx.discount());
    }

    /**
     * A member's balance lives in two columns — what they have paid and what
     * they still owe — and both have to move on every payment. This used to
     * touch only amount_due, so amount_paid never grew. membersWithDues() below
     * billed off GREATEST(amount_due, fee - amount_paid), and that second term
     * stayed frozen at the original balance forever: a member who had paid in
     * full still qualified as owing, and "Collect All" would charge them again.
     */
    @Override
    public void reduceDue(Long memberId, BigDecimal amount) {
        jdbc.update("""
            UPDATE clients
            SET amount_paid = COALESCE(amount_paid, 0) + ?,
                amount_due  = GREATEST(0, COALESCE(amount_due, 0) - ?)
            WHERE id = ?""",
            amount, amount, memberId);
    }

    /**
     * amount_due is the one definition of "owed", because it is the number the
     * Outstanding Dues list on screen filters by. This used to take the GREATER
     * of amount_due and (fee - amount_paid), so the desk could be asked to
     * collect from someone the screen never listed — the two disagreed on who
     * owed money. reduceDue now keeps both columns in step, and a single
     * definition here keeps them that way.
     */
    @Override
    public List<Map<String, Object>> membersWithDues() {
        return jdbc.queryForList("""
            SELECT id, name, membership_fee, amount_paid, amount_due, payment_mode
            FROM clients
            WHERE COALESCE(amount_due, 0) > 0""");
    }

    @Override
    public void clearDues(Long memberId, String mode) {
        jdbc.update(
            "UPDATE clients SET amount_paid = membership_fee, amount_due = 0, payment_mode = ? WHERE id = ?",
            mode, memberId);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update("DELETE FROM payments WHERE id = ?", id);
    }

    @Override
    public BigDecimal sumToday() {
        return jdbc.queryForObject(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payment_date = CURRENT_DATE", BigDecimal.class);
    }

    @Override
    public BigDecimal sumMonth() {
        return jdbc.queryForObject(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payment_date >= date_trunc('month', CURRENT_DATE)",
            BigDecimal.class);
    }
}
