package com.gymos.invoices.dao.impl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.invoices.dao.InvoiceDao;

@Repository
public class InvoiceDaoImpl implements InvoiceDao {

    private static final int LIST_LIMIT = 500;

    private final JdbcTemplate jdbc;

    public InvoiceDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findInvoices(String from, String to, Long memberId,
                                                  String status, String search) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (isSet(from)) {
            values.add(from);
            where.add("i.invoice_date >= ?");
        }
        if (isSet(to)) {
            values.add(to);
            where.add("i.invoice_date <= ?");
        }
        if (memberId != null) {
            values.add(memberId);
            where.add("i.member_id = ?");
        }
        if (isSet(status)) {
            values.add(status);
            where.add("i.status = ?");
        }
        if (isSet(search)) {
            String like = "%" + search.toLowerCase() + "%";
            values.add(like);
            values.add(like);
            where.add("(LOWER(i.invoice_no) LIKE ? OR LOWER(i.customer_name) LIKE ?)");
        }
        String sql = """
            SELECT i.*, c.member_code, u.name AS issued_by_name,
                   (SELECT COUNT(*)::int FROM invoice_items it WHERE it.invoice_id = i.id) AS item_count
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.member_id
            LEFT JOIN users u ON u.id = i.issued_by"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY i.invoice_date DESC, i.id DESC\nLIMIT " + LIST_LIMIT;
        return values.isEmpty() ? jdbc.queryForList(sql) : jdbc.queryForList(sql, values.toArray());
    }

    private static boolean isSet(String v) {
        return v != null && !v.isBlank();
    }

    @Override
    public Optional<Map<String, Object>> findInvoiceForPrint(Long id) {
        return jdbc.queryForList("""
            SELECT i.*, c.member_code, c.phone AS member_phone, c.email AS member_email,
                   u.name AS issued_by_name, b.name AS branch_name, b.address AS branch_address,
                   b.gst_number AS branch_gst
            FROM invoices i
            LEFT JOIN clients c ON c.id = i.member_id
            LEFT JOIN users u ON u.id = i.issued_by
            LEFT JOIN branches b ON b.id = i.branch_id
            WHERE i.id = ?""", id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM invoices WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public List<Map<String, Object>> findItems(Long invoiceId) {
        return jdbc.queryForList("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", invoiceId);
    }

    @Override
    public void lockInvoiceTableForNumbering() {
        jdbc.execute("LOCK TABLE invoices IN SHARE ROW EXCLUSIVE MODE");
    }

    @Override
    public Optional<String> lastInvoiceNoOfYear(String prefix, int year) {
        return jdbc.queryForList(
            "SELECT invoice_no FROM invoices WHERE invoice_no LIKE ? ORDER BY id DESC LIMIT 1",
            prefix + "-" + year + "-%")
            .stream().findFirst().map(row -> String.valueOf(row.get("invoice_no")));
    }

    @Override
    public Map<String, Object> insertInvoice(String invoiceNo, Long memberId, String customerName,
                                             String invoiceDate, BigDecimal subtotal, BigDecimal taxAmount,
                                             BigDecimal total, String method, String notes,
                                             Long issuedBy, Long branchId) {
        return jdbc.queryForMap("""
            INSERT INTO invoices (invoice_no, member_id, customer_name, invoice_date, subtotal,
                                  tax_amount, total, method, notes, issued_by, branch_id)
            VALUES (?, ?, ?, COALESCE(?::date, CURRENT_DATE), ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            invoiceNo, memberId, customerName, invoiceDate, subtotal, taxAmount, total,
            method, notes, issuedBy, branchId);
    }

    @Override
    public Map<String, Object> insertItem(Long invoiceId, String description, String hsnSac, BigDecimal quantity,
                                          BigDecimal unitPrice, BigDecimal taxRate, BigDecimal taxAmount,
                                          BigDecimal lineTotal) {
        return jdbc.queryForMap("""
            INSERT INTO invoice_items (invoice_id, description, hsn_sac, quantity, unit_price,
                                       tax_rate, tax_amount, line_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *""",
            invoiceId, description, hsnSac, quantity, unitPrice, taxRate, taxAmount, lineTotal);
    }

    @Override
    public Map<String, Object> update(Long id, String status, String method, String notes) {
        return jdbc.queryForMap("""
            UPDATE invoices SET status = COALESCE(?, status), method = COALESCE(?, method),
                                notes = COALESCE(?, notes)
            WHERE id = ? RETURNING *""", status, method, notes, id);
    }

    @Override
    public Map<String, Object> cancel(Long id) {
        return jdbc.queryForMap("UPDATE invoices SET status = 'cancelled' WHERE id = ? RETURNING *", id);
    }

    @Override
    public Optional<Map<String, Object>> findMemberForInvoice(Long memberId) {
        return jdbc.queryForList("SELECT id, name, branch_id FROM clients WHERE id = ?", memberId)
            .stream().findFirst();
    }
}
