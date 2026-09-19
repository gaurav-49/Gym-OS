package com.gymos.common.security;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.gymos.auth.dao.UserDao;
import com.gymos.common.api.BusinessException;

/**
 * The rules a new password must satisfy, in one place so every path that sets
 * a password enforces the same ones — the OTP reset, an admin editing a user,
 * and the forced change after a lockout.
 *
 * <p>Reuse is checked against stored BCrypt hashes, which cannot be compared
 * with equals(): each candidate has its own salt, so the same password hashes
 * differently every time. Every historical hash has to be matched individually,
 * which is why the window is small and configurable.
 */
@Service
public class PasswordPolicy {

    private final UserDao userDao;
    private final PasswordEncoder passwordEncoder;
    private final int minLength;
    private final int historyDepth;

    public PasswordPolicy(UserDao userDao, PasswordEncoder passwordEncoder,
                          @Value("${app.password.min-length:6}") int minLength,
                          @Value("${app.password.history-depth:5}") int historyDepth) {
        this.userDao = userDao;
        this.passwordEncoder = passwordEncoder;
        this.minLength = minLength;
        this.historyDepth = historyDepth;
    }

    public int historyDepth() {
        return historyDepth;
    }

    /**
     * Validate a proposed password for an existing account and, if it passes,
     * return the hash to store.
     *
     * @throws BusinessException 400 when it is too short or previously used
     */
    public String hashForChange(Long userId, String newPassword) {
        validateFormat(newPassword);
        if (isPreviouslyUsed(userId, newPassword)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                historyDepth == 1
                    ? "Your new password must be different from your current one."
                    : "Your new password must be different from your last "
                        + historyDepth + " passwords. Please choose one you have not used before.");
        }
        return passwordEncoder.encode(newPassword);
    }

    /**
     * Shape rules only — no database access, so callers can reject an obviously
     * bad password before spending a lookup or an OTP on it.
     */
    public void validateFormat(String newPassword) {
        if (newPassword == null || newPassword.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "New password is required.");
        }
        if (newPassword.length() < minLength) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "New password must be at least " + minLength + " characters.");
        }
    }

    /** @return true when the candidate matches the current or a recent password */
    public boolean isPreviouslyUsed(Long userId, String candidate) {
        if (userId == null) {
            return false;
        }
        List<String> recent = userDao.recentPasswordHashes(userId, historyDepth);
        for (String hash : recent) {
            if (hash != null && passwordEncoder.matches(candidate, hash)) {
                return true;
            }
        }
        // An account created before password_history existed, or one whose
        // history was trimmed, still must not be able to re-set what it has now.
        return userDao.findById(userId)
            .map(u -> u.passwordHash() != null && passwordEncoder.matches(candidate, u.passwordHash()))
            .orElse(false);
    }
}
