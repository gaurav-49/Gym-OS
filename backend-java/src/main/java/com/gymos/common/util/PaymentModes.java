package com.gymos.common.util;

import java.util.List;

/**
 * Payment-mode validation — exact port of backend/src/utils/paymentModes.js.
 * A null/empty value passes (the caller decides the default); anything else
 * must be one of the five accepted modes.
 */
public final class PaymentModes {

    public static final List<String> MODES = List.of("Cash", "UPI", "Card", "Bank Transfer", "Online");
    public static final String ERROR = "method must be one of: Cash, UPI, Card, Bank Transfer, Online";

    private PaymentModes() {
    }

    public static boolean isValid(String value) {
        if (value == null || value.isEmpty()) return true;
        return MODES.contains(value.trim());
    }
}
