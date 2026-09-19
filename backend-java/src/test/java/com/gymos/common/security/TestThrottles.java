package com.gymos.common.security;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Login-throttle test doubles. Subclassing the real service (rather than
 * mocking it) keeps the unit tests free of stubbing ceremony while still
 * exercising the production call sequence: keysFor → registerFailure /
 * clearFailures.
 */
public final class TestThrottles {

    private TestThrottles() {
    }

    /** Allowance never runs out — for tests about anything else. */
    public static LoginThrottleService open() {
        return new Stub(false);
    }

    /** Every failure reports the allowance as already spent. */
    public static LoginThrottleService exhausted() {
        return new Stub(true);
    }

    /** Counts failures so a test can assert the "N attempt(s) left" countdown. */
    public static Counting counting() {
        return new Counting();
    }

    /**
     * The next failure spends the last of the allowance — for testing what
     * happens at that moment without driving five logins to get there.
     */
    public static LoginThrottleService exhaustOnFailure() {
        return new Stub(true);
    }

    private static class Stub extends LoginThrottleService {
        private final boolean spent;

        Stub(boolean spent) {
            super(null, 5, 20, 0, 15);
            this.spent = spent;
        }

        @Override
        public List<Key> keysFor(String scope, String account, HttpServletRequest request) {
            return List.of(new Key(scope, account == null ? "" : account));
        }

        @Override
        public Failure registerFailure(List<Key> keys) {
            return spent ? new Failure(true, 0) : new Failure(false, 4);
        }

        @Override
        public void applyPenaltyDelay(List<Key> keys) {
            // never sleep in a unit test
        }

        @Override
        public void clearFailures(List<Key> keys) {
            // nothing to clear in a stub
        }
    }

    /** Locks on the 5th failure, like the real service's default limit. */
    public static final class Counting extends LoginThrottleService {
        private int failures;
        private int cleared;

        Counting() {
            super(null, 5, 20, 0, 15);
        }

        public int failures() {
            return failures;
        }

        public int cleared() {
            return cleared;
        }

        @Override
        public List<Key> keysFor(String scope, String account, HttpServletRequest request) {
            return List.of(new Key(scope, account == null ? "" : account));
        }

        @Override
        public Failure registerFailure(List<Key> keys) {
            failures++;
            return new Failure(failures >= 5, Math.max(0, 5 - failures));
        }

        @Override
        public void applyPenaltyDelay(List<Key> keys) {
            // never sleep in a unit test
        }

        @Override
        public void clearFailures(List<Key> keys) {
            cleared++;
            failures = 0;
        }
    }
}
