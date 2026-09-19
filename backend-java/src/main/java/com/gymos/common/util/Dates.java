package com.gymos.common.util;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.ResolverStyle;

/**
 * Shared date + membership helpers — exact port of the Node utils (dates.js,
 * membership.js + the local copies in clientController). All dates are handled
 * as LOCAL YYYY-MM-DD strings so behaviour is identical in any timezone.
 */
public final class Dates {

    private static final DateTimeFormatter YMD = DateTimeFormatter.ofPattern("uuuu-MM-dd")
        .withResolverStyle(ResolverStyle.STRICT);

    private static final DateTimeFormatter FRIENDLY =
        DateTimeFormatter.ofPattern("d MMM uuuu", java.util.Locale.ENGLISH);

    private Dates() {
    }

    /** True only for real calendar dates in YYYY-MM-DD (rejects 2026-13-40, 2026-02-30…). */
    public static boolean isValidDateString(String s) {
        if (s == null || !s.matches("\\d{4}-\\d{2}-\\d{2}")) return false;
        try {
            LocalDate.parse(s, YMD);
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    public static String todayStr() {
        return LocalDate.now().toString();
    }

    /**
     * True when the date is after today.
     *
     * <p>Used wherever a record describes something that has already happened —
     * a payment taken, an expense incurred, a weight measured. Those cannot be
     * dated forward: they land in a future month's totals and make the books
     * stop matching reality on the day they are entered.
     */
    public static boolean isFuture(String dateStr) {
        return dateStr != null && !dateStr.isBlank()
            && dateStr.substring(0, Math.min(10, dateStr.length())).compareTo(todayStr()) > 0;
    }

    /**
     * "2026-09-05" as "5 Sep 2026", for messages a member reads. Locale is
     * pinned so a server started in another locale does not tell an Indian gym
     * its membership expired on "5 sept. 2026".
     */
    public static String friendly(String dateStr) {
        if (dateStr == null || dateStr.isBlank()) {
            return "";
        }
        try {
            return LocalDate.parse(dateStr.substring(0, Math.min(10, dateStr.length())), YMD)
                .format(FRIENDLY);
        } catch (RuntimeException e) {
            // Never let a display helper break the message it is inside.
            return dateStr;
        }
    }

    /** Add whole days to a YYYY-MM-DD string using local date parts. */
    public static String addDays(String dateStr, int days) {
        try {
            return LocalDate.parse(dateStr, YMD).plusDays(days).toString();
        } catch (RuntimeException e) {
            return dateStr; // never throw on bad input, like Node
        }
    }

    /**
     * Length of a membership plan in days.
     *
     * <p>2.0: this used to be a hardcoded switch, which meant a gym's own 45-day
     * package silently expired after 30. It now reads the plans master through
     * {@link com.gymos.plans.service.PlanCatalog}, which falls back to the same
     * built-in values when the plans table has not been migrated yet.
     */
    public static int durationDays(String type) {
        return com.gymos.plans.service.PlanCatalog.durationDays(type);
    }

    /** New expiry for a renewal: extend from the later of (current expiry, today). */
    public static String nextExpiry(String currentExpiry, String membershipType) {
        return addDays(periodStart(currentExpiry), durationDays(membershipType));
    }

    /**
     * The first day a renewal covers: where the current term ends, or today if
     * it has already lapsed. A renewed member does not lose the days they have
     * left, and a lapsed one does not get billed for the gap.
     *
     * <p>Receipts record this, so a member can see which term their money
     * bought rather than the term they happen to be on when they read it.
     */
    public static String periodStart(String currentExpiry) {
        return currentExpiry != null && currentExpiry.compareTo(todayStr()) >= 0
            ? currentExpiry : todayStr();
    }

    /** Format a date for Postgres: supports yyyy-mm-dd and dd/mm/yyyy. */
    public static String formatDateForPostgres(String inputDate) {
        if (inputDate == null) return null;
        if (inputDate.matches("\\d{4}-\\d{2}-\\d{2}")) return inputDate;
        String[] parts = inputDate.split("/");
        if (parts.length == 3) {
            return parts[2] + "-" + pad(parts[1]) + "-" + pad(parts[0]);
        }
        return inputDate;
    }

    private static String pad(String s) {
        return s.length() < 2 ? "0" + s : s;
    }

    /** HH:mm or HH:mm:ss. */
    public static boolean isTime(String v) {
        return v != null && v.matches("\\d{2}:\\d{2}(:\\d{2})?");
    }

    /**
     * A record of something that has happened cannot be dated after today.
     *
     * <p>A payment, a sale, a check-in and an invoice are all statements about the
     * past; every one of them accepted a date years ahead, which silently moved
     * money and stock into a period no report covers. Scheduling — a class, a
     * membership expiry — is the opposite and must not use this.
     *
     * @return an explanation, or null when the date is acceptable
     */
    public static String futureError(String field, String dateStr) {
        if (dateStr == null || dateStr.isBlank()) return null;
        if (dateStr.compareTo(todayStr()) > 0) {
            return "The " + field + " cannot be in the future (" + friendly(dateStr) + ").";
        }
        return null;
    }

    /**
     * An end that lands before its start. Both are ISO dates, which compare
     * lexicographically, so this holds for times in HH:mm too.
     *
     * @return an explanation, or null when the pair is in order
     */
    public static String orderError(String startLabel, String start, String endLabel, String end) {
        if (start == null || end == null || start.isBlank() || end.isBlank()) return null;
        if (end.compareTo(start) < 0) {
            return "The " + endLabel + " (" + friendly(end) + ") cannot be before the "
                + startLabel + " (" + friendly(start) + ").";
        }
        return null;
    }
}
