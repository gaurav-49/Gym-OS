package com.gymos.invoices.service.impl;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.common.util.PaymentModes;
import com.gymos.invoices.dao.InvoiceDao;
import com.gymos.invoices.service.InvoiceService;

@Service
public class InvoiceServiceImpl implements InvoiceService {

    private static final List<String> STATUSES = List.of("issued", "paid", "cancelled");
    private static final int MAX_ITEMS = 50;

    private final InvoiceDao invoiceDao;
    private final AuditService audit;
    private final TransactionTemplate tx;

    private final com.gymos.branding.service.BrandingService brandingService;

    public InvoiceServiceImpl(InvoiceDao invoiceDao, AuditService audit, TransactionTemplate tx,
                              com.gymos.branding.service.BrandingService brandingService) {
        this.invoiceDao = invoiceDao;
        this.audit = audit;
        this.tx = tx;
        this.brandingService = brandingService;
    }

    /** One priced line: net, tax and total derived from quantity × unit price. */
    private record PricedLine(BigDecimal quantity, BigDecimal unitPrice, BigDecimal taxRate,
                              BigDecimal net, BigDecimal tax, BigDecimal lineTotal) { }

    @Override
    public List<Map<String, Object>> list(String from, String to, Long memberId, String status, String search) {
        requireDate("from", from);
        requireDate("to", to);
        if (status != null && !status.isBlank() && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
        return invoiceDao.findInvoices(from, to, memberId, status, search);
    }

    @Override
    public Map<String, Object> get(Long id) {
        Map<String, Object> invoice = invoiceDao.findInvoiceForPrint(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Invoice not found"));
        Map<String, Object> out = new LinkedHashMap<>(invoice);
        out.put("items", invoiceDao.findItems(id));
        return out;
    }

    @Override
    @SuppressWarnings("unchecked")
    public Map<String, Object> create(Map<String, Object> body, Long issuedBy) {
        Object rawItems = body.get("items");
        if (!(rawItems instanceof List<?> list) || list.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "An invoice needs at least one line item");
        }
        if (list.size() > MAX_ITEMS) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "An invoice can hold at most " + MAX_ITEMS + " line items");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object o : list) {
            items.add(o instanceof Map ? (Map<String, Object>) o : Map.of());
        }

        List<PricedLine> priced = new ArrayList<>();
        for (int i = 0; i < items.size(); i++) {
            priced.add(priceLine(items.get(i), i + 1));
        }

        String invoiceDate = Body.str(body, "invoice_date");
        requireDate("invoice_date", invoiceDate);
        // A tax invoice is a record of a sale that has happened. Payments and
        // expenses both refuse a future date; this did not, so an invoice could
        // be booked into a period no report covers.
        String invoiceFuture = Dates.futureError("invoice date", invoiceDate);
        if (invoiceFuture != null) throw new BusinessException(HttpStatus.BAD_REQUEST, invoiceFuture);
        String method = Body.str(body, "method");
        if (!PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        Long memberId = Body.toLong(body.get("member_id"));
        String customerName = Body.str(body, "customer_name");
        String notes = Body.str(body, "notes");

        Map<String, Object> result = tx.execute(status -> {
            String name = customerName == null ? "" : customerName.trim();
            Long branchId = null;
            if (memberId != null) {
                Map<String, Object> member = invoiceDao.findMemberForInvoice(memberId).orElseThrow(() ->
                    new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
                if (name.isEmpty()) {
                    name = String.valueOf(member.get("name"));
                }
                branchId = Body.toLong(member.get("branch_id"));
            }
            if (name.isEmpty()) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "customer_name is required when the invoice is not linked to a member");
            }

            BigDecimal subtotal = sum(priced, PricedLine::net);
            BigDecimal taxAmount = sum(priced, PricedLine::tax);
            BigDecimal total = subtotal.add(taxAmount).setScale(2, RoundingMode.HALF_UP);

            String invoiceNo = allocateInvoiceNumber();

            Map<String, Object> invoice = invoiceDao.insertInvoice(invoiceNo, memberId, name,
                blankToNull(invoiceDate), subtotal, taxAmount, total, method, notes, issuedBy, branchId);
            Long invoiceId = Body.toLong(invoice.get("id"));

            List<Map<String, Object>> saved = new ArrayList<>();
            for (int i = 0; i < items.size(); i++) {
                PricedLine line = priced.get(i);
                saved.add(invoiceDao.insertItem(invoiceId,
                    String.valueOf(items.get(i).get("description")).trim(),
                    Body.str(items.get(i), "hsn_sac"),
                    line.quantity(), line.unitPrice(), line.taxRate(), line.tax(), line.lineTotal()));
            }

            // The invoice fields are spread at the top level (the frontend reads
            // invoice_no/total directly), with the message added afterwards so a
            // column named "message" could never shadow it.
            Map<String, Object> out = new LinkedHashMap<>(invoice);
            out.put("message", "Invoice " + invoiceNo + " issued for ₹" + total + ".");
            out.put("items", saved);
            out.put("_auditName", name);
            out.put("_auditTotal", total);
            return out;
        });

        audit.record("create", "invoices", result.get("id"),
            "Issued " + result.get("invoice_no") + " to " + result.get("_auditName")
                + " for ₹" + result.get("_auditTotal"));
        result.remove("_auditName");
        result.remove("_auditTotal");
        return result;
    }

    /**
     * Next sequential number for this calendar year, e.g. {@code INV-2026-0007}.
     * The table lock is taken first so two clerks issuing at the same instant
     * serialise instead of colliding on the same number.
     */
    private String allocateInvoiceNumber() {
        invoiceDao.lockInvoiceTableForNumbering();
        int year = LocalDate.now().getYear();
        // The series is the gym's, not the product's — an accountant reading
        // these wants the books' own numbering.
        String prefix = brandingService.invoicePrefix();
        int next = invoiceDao.lastInvoiceNoOfYear(prefix, year)
            .map(no -> {
                // The trailing run of digits, not split("-")[2]: a gym may set a
                // series like GG/2026, and splitting on "-" would read the wrong
                // field and restart the sequence at 1 on a live book.
                java.util.regex.Matcher m = TRAILING_NUMBER.matcher(no);
                try {
                    return m.find() ? Integer.parseInt(m.group(1)) + 1 : 1;
                } catch (NumberFormatException e) {
                    return 1;
                }
            })
            .orElse(1);
        return prefix + "-" + year + "-" + String.format("%04d", next);
    }

    private static final java.util.regex.Pattern TRAILING_NUMBER =
        java.util.regex.Pattern.compile("(\\d+)\\s*$");

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        if (status != null && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
        String method = body.containsKey("method") ? Body.str(body, "method") : null;
        if (method != null && !PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }

        Map<String, Object> existing = invoiceDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Invoice not found"));
        String invoiceNo = String.valueOf(existing.get("invoice_no"));

        // A cancelled tax document cannot be revived — the correction is a new invoice.
        if ("cancelled".equals(String.valueOf(existing.get("status")))
            && status != null && !"cancelled".equals(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                invoiceNo + " is cancelled — issue a fresh invoice instead.");
        }

        Map<String, Object> updated = invoiceDao.update(id, status, method,
            body.containsKey("notes") ? Body.str(body, "notes") : null);
        audit.record("update", "invoices", id, invoiceNo + " → " + updated.get("status"));
        return updated;
    }

    @Override
    public Map<String, Object> cancel(Long id) {
        Map<String, Object> existing = invoiceDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Invoice not found"));
        String invoiceNo = String.valueOf(existing.get("invoice_no"));
        if ("cancelled".equals(String.valueOf(existing.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, invoiceNo + " is already cancelled.");
        }
        Map<String, Object> cancelled = invoiceDao.cancel(id);
        audit.record("cancel", "invoices", id, "Cancelled " + invoiceNo);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", invoiceNo + " cancelled. Tax invoices are never deleted —"
            + " the number stays in the sequence.");
        out.put("invoice", cancelled);
        return out;
    }

    // ---- helpers -------------------------------------------------------------

    private static PricedLine priceLine(Map<String, Object> item, int lineNo) {
        String description = Body.str(item, "description");
        if (description == null || description.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Line " + lineNo + ": description is required");
        }
        BigDecimal qty = decimalOr(item.get("quantity"), BigDecimal.ONE);
        if (qty == null || qty.signum() <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Line " + lineNo + ": quantity must be greater than 0");
        }
        BigDecimal unit = decimalOr(item.get("unit_price"), BigDecimal.ZERO);
        if (unit == null || unit.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Line " + lineNo + ": unit_price must be a non-negative number");
        }
        BigDecimal rate = decimalOr(item.get("tax_rate"), BigDecimal.ZERO);
        if (rate == null || rate.signum() < 0 || rate.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Line " + lineNo + ": tax_rate must be between 0 and 100");
        }
        BigDecimal net = qty.multiply(unit).setScale(2, RoundingMode.HALF_UP);
        BigDecimal tax = net.multiply(rate).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
        return new PricedLine(qty, unit, rate, net, tax, net.add(tax).setScale(2, RoundingMode.HALF_UP));
    }

    private static BigDecimal decimalOr(Object v, BigDecimal fallback) {
        if (v == null || String.valueOf(v).isBlank()) {
            return fallback;
        }
        return Body.toDecimal(v);
    }

    private static BigDecimal sum(List<PricedLine> lines,
                                  java.util.function.Function<PricedLine, BigDecimal> field) {
        BigDecimal total = BigDecimal.ZERO;
        for (PricedLine line : lines) {
            total = total.add(field.apply(line));
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }
}
