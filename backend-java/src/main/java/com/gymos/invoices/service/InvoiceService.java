package com.gymos.invoices.service;

import java.util.List;
import java.util.Map;

/**
 * Numbered tax invoices.
 *
 * <p>{@code payments} records that money arrived; an invoice is the document
 * saying what it was for — per-line HSN/SAC codes and tax, a sequential number,
 * and a total the gym can hand to an accountant.
 */
public interface InvoiceService {

    List<Map<String, Object>> list(String from, String to, Long memberId, String status, String search);

    /** The full document, with its line items. */
    Map<String, Object> get(Long id);

    Map<String, Object> create(Map<String, Object> body, Long issuedBy);

    /** Only the settlement state moves — the document itself is immutable once issued. */
    Map<String, Object> update(Long id, Map<String, Object> body);

    /** Cancels rather than deletes: the number must stay in the sequence. */
    Map<String, Object> cancel(Long id);
}
