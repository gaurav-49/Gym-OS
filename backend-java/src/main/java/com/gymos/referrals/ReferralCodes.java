package com.gymos.referrals;

import java.util.Locale;

/**
 * The member-facing referral code: the first four letters of the member's name
 * followed by their Member ID padded to four digits — Gaurav, member 1, becomes
 * {@code GAUR0001}.
 *
 * <p>It is read aloud at the desk and typed by a friend who has never used the
 * app, so it has to be sayable and hard to mistype. The previous scheme
 * ({@code GYM} plus the internal row id) was neither: {@code GYM01768} tells
 * nobody whose code it is, and the number in it was not the Member ID printed
 * on the card — despite a comment claiming it was.
 *
 * <p>The same rule is implemented in SQL in {@code db/migrate.js} to backfill
 * existing members. Change one and you must change the other.
 */
public final class ReferralCodes {

    private static final int NAME_CHARS = 4;
    private static final int CODE_DIGITS = 4;
    /** Stands in for a missing letter so every code is the same shape. */
    private static final char FILLER = 'X';

    private ReferralCodes() {
    }

    /**
     * @param name       the member's name; non-letters are dropped, so
     *                   "O'Brien" gives OBRI and "S K Rao" gives SKRA
     * @param memberCode the Member ID printed on the card
     */
    public static String forMember(String name, String memberCode) {
        String letters = name == null ? "" : name.toUpperCase(Locale.ROOT).replaceAll("[^A-Z]", "");
        StringBuilder prefix = new StringBuilder(letters.length() >= NAME_CHARS
            ? letters.substring(0, NAME_CHARS)
            : letters);
        while (prefix.length() < NAME_CHARS) {
            prefix.append(FILLER);
        }

        String digits = memberCode == null ? "" : memberCode.replaceAll("\\D", "");
        // Longer Member IDs are kept whole rather than truncated — a code that
        // silently drops a digit would point at a different member.
        StringBuilder suffix = new StringBuilder(digits);
        while (suffix.length() < CODE_DIGITS) {
            suffix.insert(0, '0');
        }
        return prefix.toString() + suffix;
    }
}
