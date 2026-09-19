package com.gymos.auth.dao;

import java.util.List;
import java.util.Optional;

import com.gymos.auth.entity.User;

/**
 * User data access interface. All SQL for this module lives in
 * {@link com.gymos.auth.dao.impl.UserDaoImpl} — services never see SQL.
 */
public interface UserDao {

    Optional<User> findByUsername(String username);

    Optional<User> findById(Long id);

    /** The signed-in staff member's own light/dark choice. */
    String findThemePreference(Long id);

    void updateThemePreference(Long id, String theme);

    List<User> findAll();

    /** @return the inserted row (with generated id + created_at) */
    User insert(String username, String passwordHash, String name, String role, String email, String phone);

    /** COALESCE semantics: only non-null fields are written (handled by the caller). */
    void update(Long id, String name, String role, String email, String phone, String passwordHash);

    /** @return number of rows deleted */
    int delete(Long id);

    /**
     * Replace the password, archive the old hash and clear any forced-reset
     * flag — one call so the three can never drift apart.
     */
    void changePassword(Long id, String newPasswordHash);

    /** Most recent password hashes first, newest {@code limit} only. */
    List<String> recentPasswordHashes(Long id, int limit);

    /** Require a password change before this account can sign in again. */
    void setMustResetPassword(Long id, boolean mustReset);
}
