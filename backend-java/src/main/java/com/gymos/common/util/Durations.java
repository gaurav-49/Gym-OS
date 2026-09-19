package com.gymos.common.util;

/**
 * Turns a wait in seconds into something a person reads without doing
 * arithmetic. Shared by the staff and member reset flows so both count down in
 * the same words — "10 minutes", never "600 seconds".
 */
public final class Durations {

    private Durations() {
    }

    /** "45 seconds" / "10 minutes" / "1 hour" — never a bare second count. */
    public static String describe(long seconds) {
        if (seconds < 60) {
            return seconds + " second" + (seconds == 1 ? "" : "s");
        }
        long minutes = (seconds + 59) / 60;
        if (minutes < 60) {
            return minutes + " minute" + (minutes == 1 ? "" : "s");
        }
        long hours = (minutes + 59) / 60;
        return hours + " hour" + (hours == 1 ? "" : "s");
    }
}
