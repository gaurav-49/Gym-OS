package com.gymos.auth.dao.impl;

import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.gymos.auth.dao.UserDao;
import com.gymos.auth.entity.User;

/**
 * User DAO implementation — the SQL for the auth/users module lives here
 * (queries + row mapping), keeping the DAO interface and service layers
 * SQL-free.
 */
@Repository
public class UserDaoImpl implements UserDao {

    private final JdbcTemplate jdbc;

    public UserDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static final String COLUMNS = "id, username, password_hash, name, role, email, phone, created_at, must_reset_password";

    @Override
    public String findThemePreference(Long id) {
        return jdbc.query("SELECT theme_preference FROM users WHERE id = ?",
            rs -> rs.next() ? rs.getString(1) : null, id);
    }

    @Override
    public void updateThemePreference(Long id, String theme) {
        jdbc.update("UPDATE users SET theme_preference = ? WHERE id = ?", theme, id);
    }

    // Usernames are compared without case (see Usernames): the caller passes a
    // normalised value, and LOWER() on the column catches rows stored before
    // that rule existed.
    private static final String SELECT_BY_USERNAME =
        "SELECT " + COLUMNS + " FROM users WHERE LOWER(username) = ?";
    private static final String SELECT_BY_ID = "SELECT " + COLUMNS + " FROM users WHERE id = ?";
    private static final String SELECT_ALL = "SELECT " + COLUMNS + " FROM users ORDER BY id";
    private static final String INSERT = """
        INSERT INTO users (username, password_hash, name, role, email, phone)
        VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, username, password_hash, name, role, email, phone, created_at, must_reset_password
        """;
    private static final String UPDATE = """
        UPDATE users SET name = ?, role = ?, email = ?, phone = ?, password_hash = ?
        WHERE id = ?
        """;
    private static final String DELETE = "DELETE FROM users WHERE id = ?";

    private static final RowMapper<User> MAPPER = (rs, i) -> new User(
        rs.getLong("id"),
        rs.getString("username"),
        rs.getString("password_hash"),
        rs.getString("name"),
        rs.getString("role"),
        rs.getString("email"),
        rs.getString("phone"),
        rs.getTimestamp("created_at") != null ? rs.getTimestamp("created_at").toInstant() : null,
        rs.getBoolean("must_reset_password")
    );

    @Override
    public Optional<User> findByUsername(String username) {
        return jdbc.query(SELECT_BY_USERNAME, MAPPER,
            com.gymos.common.security.Usernames.normalise(username)).stream().findFirst();
    }

    @Override
    public Optional<User> findById(Long id) {
        return jdbc.query(SELECT_BY_ID, MAPPER, id).stream().findFirst();
    }

    @Override
    public List<User> findAll() {
        return jdbc.query(SELECT_ALL, MAPPER);
    }

    @Override
    public User insert(String username, String passwordHash, String name, String role,
                       String email, String phone) {
        return jdbc.queryForObject(INSERT, MAPPER, username, passwordHash, name, role, email, phone);
    }

    @Override
    public void update(Long id, String name, String role, String email, String phone, String passwordHash) {
        jdbc.update(UPDATE, name, role, email, phone, passwordHash, id);
    }

    @Override
    public int delete(Long id) {
        return jdbc.update(DELETE, id);
    }

    @Override
    public void changePassword(Long id, String newPasswordHash) {
        // Archive first: if the update failed we would rather have a spare
        // history row than lose the hash we were about to overwrite.
        jdbc.update("INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)",
            id, newPasswordHash);
        jdbc.update("""
            UPDATE users
            SET password_hash = ?, password_changed_at = NOW(), must_reset_password = FALSE
            WHERE id = ?""", newPasswordHash, id);
    }

    @Override
    public List<String> recentPasswordHashes(Long id, int limit) {
        return jdbc.queryForList("""
            SELECT password_hash FROM password_history
            WHERE user_id = ?
            ORDER BY changed_at DESC, id DESC
            LIMIT ?""", String.class, id, limit);
    }

    @Override
    public void setMustResetPassword(Long id, boolean mustReset) {
        jdbc.update("UPDATE users SET must_reset_password = ? WHERE id = ?", mustReset, id);
    }
}
