package com.gymos.common.util;

/** Shared masking helpers — exact port of the Node otpService maskEmail/maskPhone. */
public final class MaskingUtils {

    private MaskingUtils() {
    }

    public static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at <= 0) return email;
        String local = email.substring(0, at);
        String domain = email.substring(at + 1);
        String visible = local.substring(0, Math.min(2, local.length()));
        String stars = "*".repeat(Math.max(2, local.length() - 2));
        return visible + stars + "@" + domain;
    }

    public static String maskPhone(String phone) {
        String digits = phone.replaceAll("\\D", "");
        if (digits.length() < 5) return "****";
        return digits.substring(0, 2) + "****" + digits.substring(digits.length() - 2);
    }
}
