package com.gymos.payment.dao;

import java.math.BigDecimal;

/**
 * What a payment was actually for, recorded on the row itself.
 *
 * <p>The payments table used to hold only an amount, a method and a free-text
 * note, so anything printing a receipt had to guess the rest — and every
 * receipt guessed the same way, by reading the member's <em>current</em>
 * membership. A personal-training payment therefore printed "Plan: Yearly,
 * valid until 11 August 2027", which was the membership the member happened to
 * hold, not the thing the money bought.
 *
 * <p>So each write says what it is. The plan name and the period are copied in
 * rather than joined at read time on purpose: a plan renamed, repriced or
 * renewed next year must not change what a receipt already in a member's hands
 * says.
 *
 * @param purpose     one of {@code membership}, {@code pt}, {@code locker},
 *                    {@code dues}, {@code other}
 * @param referenceId the row this paid for — a PT subscription id — or null
 * @param planName    the plan as it was named on the day
 * @param periodStart first day the payment covers, or null when it buys no period
 * @param periodEnd   last day the payment covers, or null
 * @param discount    what came off the list price — a referral reward — so the
 *                    receipt can show the charge, the reward and the amount
 *                    received as three separate lines that add up
 */
public record PaymentContext(String purpose, Long referenceId, String planName,
                             String periodStart, String periodEnd, BigDecimal discount) {

    public static final String MEMBERSHIP = "membership";
    public static final String PT = "pt";
    public static final String LOCKER = "locker";
    public static final String DUES = "dues";
    public static final String OTHER = "other";

    /** Joining, renewing or upgrading — the payment buys a membership term. */
    public static PaymentContext membership(String planName, String periodStart, String periodEnd) {
        return new PaymentContext(MEMBERSHIP, null, planName, periodStart, periodEnd, BigDecimal.ZERO);
    }

    /** A personal-training term, tied to the subscription it paid for. */
    public static PaymentContext pt(Long subscriptionId, String planName,
                                    String periodStart, String periodEnd) {
        return new PaymentContext(PT, subscriptionId, planName, periodStart, periodEnd, BigDecimal.ZERO);
    }

    /** A locker's rent, tied to the locker it was paid for. */
    public static PaymentContext locker(Long lockerId, String lockerNumber,
                                        String periodStart, String periodEnd) {
        return new PaymentContext(LOCKER, lockerId, "Locker " + lockerNumber,
            periodStart, periodEnd, BigDecimal.ZERO);
    }

    /**
     * Settling what was already owed. It buys no new period — the term it
     * belongs to was sold by an earlier payment — so the receipt says so
     * instead of repeating that term's dates as though they were bought twice.
     */
    public static PaymentContext dues() {
        return new PaymentContext(DUES, null, null, null, null, BigDecimal.ZERO);
    }

    /** Money taken at the desk that names its own reason in the note. */
    public static PaymentContext other() {
        return new PaymentContext(OTHER, null, null, null, null, BigDecimal.ZERO);
    }

    /** The same payment with a reward taken off the list price. */
    public PaymentContext withDiscount(BigDecimal off) {
        return off == null || off.signum() <= 0 ? this
            : new PaymentContext(purpose, referenceId, planName, periodStart, periodEnd, off);
    }
}
