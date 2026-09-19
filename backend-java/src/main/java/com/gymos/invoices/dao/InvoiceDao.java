package com.gymos.invoices.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Numbered tax invoices and their line items. */
public interface InvoiceDao {

    List<Map<String, Object>> findInvoices(String from, String to, Long memberId, String status, String search);

    /** The full document header, with member, issuer and branch details for printing. */
    Optional<Map<String, Object>> findInvoiceForPrint(Long id);

    Optional<Map<String, Object>> findById(Long id);

    List<Map<String, Object>> findItems(Long invoiceId);

    /**
     * Serialise invoice numbering. Taken inside the create transaction so two
     * clerks issuing at the same instant cannot take the same number.
     */
    void lockInvoiceTableForNumbering();

    /** The highest invoice number issued this year, e.g. {@code INV-2026-0042}. */
    Optional<String> lastInvoiceNoOfYear(String prefix, int year);

    Map<String, Object> insertInvoice(String invoiceNo, Long memberId, String customerName, String invoiceDate,
                                      BigDecimal subtotal, BigDecimal taxAmount, BigDecimal total,
                                      String method, String notes, Long issuedBy, Long branchId);

    Map<String, Object> insertItem(Long invoiceId, String description, String hsnSac, BigDecimal quantity,
                                   BigDecimal unitPrice, BigDecimal taxRate, BigDecimal taxAmount,
                                   BigDecimal lineTotal);

    Map<String, Object> update(Long id, String status, String method, String notes);

    Map<String, Object> cancel(Long id);

    Optional<Map<String, Object>> findMemberForInvoice(Long memberId);
}
