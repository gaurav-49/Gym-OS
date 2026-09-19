package com.gymos.common.util;

import java.math.BigDecimal;
import java.util.Map;

/**
 * Helpers for reading `@RequestBody Map` bodies the way the Node backend reads
 * req.body: absent and null both read as null, `containsKey` distinguishes
 * "not sent" from "explicitly cleared", and numeric coercion never crashes.
 */
public final class Body {

    private Body() {
    }

    public static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : String.valueOf(v);
    }

    public static boolean has(Map<String, Object> body, String key) {
        return body.containsKey(key) && body.get(key) != null;
    }

    public static boolean containsKey(Map<String, Object> body, String key) {
        return body.containsKey(key);
    }

    public static Boolean bool(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return null;
        return v instanceof Boolean b ? b : Boolean.parseBoolean(String.valueOf(v));
    }

    /** Node toNonNeg: undefined/null/'' → null; invalid or negative → NaN sentinel. */
    public static BigDecimal toNonNeg(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return null;
        if (v instanceof String s && s.isEmpty()) return null;
        try {
            BigDecimal n = v instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(v));
            return n.signum() < 0 ? BigDecimal.ONE.negate() : n; // negative → caller treats as NaN
        } catch (NumberFormatException e) {
            return BigDecimal.ONE.negate(); // NaN sentinel
        }
    }

    public static boolean isNan(BigDecimal v) {
        return v != null && v.signum() < 0;
    }

    /** Plain numeric coercion for inputs like days/attempts. */
    public static int toInt(Object v) {
        try {
            return v instanceof Number n ? n.intValue() : Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public static Long toLong(Object v) {
        if (v == null) return null;
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }

    public static BigDecimal toDecimal(Object v) {
        if (v == null) return null;
        try {
            return v instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(v));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
