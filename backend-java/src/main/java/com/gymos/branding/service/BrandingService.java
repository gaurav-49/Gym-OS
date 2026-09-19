package com.gymos.branding.service;

import java.util.Map;

public interface BrandingService {

    /** The gym's public identity — safe to serve without authentication. */
    Map<String, Object> get();

    /** Replace the supplied fields; anything absent keeps its current value. */
    Map<String, Object> update(Map<String, Object> body);

    /** The invoice series this gym numbers in, e.g. {@code INV} or {@code GG/2026}. */
    String invoicePrefix();
}
