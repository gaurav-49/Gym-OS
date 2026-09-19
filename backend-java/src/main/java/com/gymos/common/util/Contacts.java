package com.gymos.common.util;

import java.util.regex.Pattern;

/**
 * What counts as a usable phone number or email address.
 *
 * <p>One rule, because a phone number is not validated for its own sake: it is
 * how the gym reaches a member about an expiring membership or an unpaid due,
 * and how the desk matches a referred friend to the invitation that earns the
 * reward. "abcdefghij" used to be accepted on a member, a lead and a referral
 * alike, and then failed silently in the reminder queue for ever.
 *
 * <p>Every method returns the message to show, or null when the value is fine —
 * the shape the existing member validators already use.
 */
public final class Contacts {

    /** Ten digits is an Indian mobile; the ceiling leaves room for a country code. */
    public static final int MIN_PHONE_DIGITS = 10;
    public static final int MAX_PHONE_DIGITS = 15;

    /** Deliberately loose: enough to catch a typo, not to adjudicate RFC 5322. */
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s.]+(\\.[^@\\s.]+)+$");

    /** Digits plus the punctuation people actually type: +91 (022) 9876-543210 */
    private static final Pattern PHONE_SHAPE = Pattern.compile("^[0-9+()\\-\\s]+$");

    private Contacts() {
    }

    /**
     * @param required whether a blank value is itself an error
     * @return the message to show, or null when acceptable
     */
    public static String phoneError(String raw, boolean required) {
        if (raw == null || raw.trim().isEmpty()) {
            return required ? "A phone number is required." : null;
        }
        String value = raw.trim();
        if (!PHONE_SHAPE.matcher(value).matches()) {
            return "A phone number can only contain digits, and + ( ) - or spaces.";
        }
        int digits = digitsOf(value).length();
        if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
            return "A phone number must be between " + MIN_PHONE_DIGITS + " and "
                + MAX_PHONE_DIGITS + " digits.";
        }
        return null;
    }

    /** @return the message to show, or null. A blank email is always acceptable. */
    public static String emailError(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        return EMAIL.matcher(raw.trim()).matches()
            ? null
            : "\"" + raw.trim() + "\" is not a valid email address.";
    }

    /** Digits only — how numbers are compared and stored, so +91 98765 43210 is one number. */
    public static String digitsOf(String raw) {
        return raw == null ? "" : raw.replaceAll("\\D", "");
    }

    /**
     * The comparable form of a phone number: its last ten digits.
     *
     * <p>digitsOf() alone leaves "+91 98765 43210", "09876543210" and
     * "9876543210" as three different strings for one phone, so any check that
     * asks "have we seen this number before?" answered no three times. Writing
     * the same friend with a country code was enough to claim a second referral
     * reward for one person.
     */
    public static String comparablePhone(String raw) {
        String d = digitsOf(raw);
        return d.length() > 10 ? d.substring(d.length() - 10) : d;
    }
}
