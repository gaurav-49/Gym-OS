package com.gymos.common.security;

import java.util.Locale;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;

import com.gymos.common.api.BusinessException;

/**
 * The one place that decides what a staff username is and how it is compared.
 *
 * <p>Usernames are matched without regard to case, passwords are not. A phone
 * keyboard capitalises the first letter of a field by default, so "Admin"
 * typed at the door is the same account as "admin" — treating those as
 * different accounts produced a login failure nobody could see the cause of,
 * and quietly gave a password guesser a fresh five-attempt allowance for every
 * capitalisation of the same name.
 *
 * <p>Passwords stay exactly as typed. Case is most of what little entropy a
 * short password has.
 */
public final class Usernames {

    /** Letters, digits, dot and underscore. Nothing else. */
    private static final Pattern ALLOWED = Pattern.compile("^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$");

    private static final int MIN_LENGTH = 3;
    private static final int MAX_LENGTH = 50;

    private Usernames() {
    }

    /**
     * The canonical form used for storage, lookup and throttle keys. Returns
     * null for null so callers can keep their own "required" message.
     */
    public static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        return raw.trim().toLowerCase(Locale.ROOT);
    }

    /**
     * @param normalised a username already through {@link #normalise}
     * @throws BusinessException 400 describing exactly what is wrong with it
     */
    public static void validate(String normalised) {
        if (normalised == null || normalised.isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "A username is required.");
        }
        if (normalised.length() < MIN_LENGTH) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A username must be at least " + MIN_LENGTH + " characters.");
        }
        if (normalised.length() > MAX_LENGTH) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A username cannot be longer than " + MAX_LENGTH + " characters.");
        }
        if (!ALLOWED.matcher(normalised).matches()) {
            // Named rather than "invalid": at a busy desk the difference
            // between "invalid" and "spaces are not allowed" is a support call.
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A username can only contain letters, numbers, dots and underscores,"
                    + " and must start and end with a letter or number.");
        }
    }
}
