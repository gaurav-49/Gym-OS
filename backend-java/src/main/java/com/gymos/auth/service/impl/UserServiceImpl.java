package com.gymos.auth.service.impl;

import java.util.List;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import com.gymos.auth.dao.UserDao;
import com.gymos.auth.dto.UserResponse;
import com.gymos.auth.entity.User;
import com.gymos.auth.service.UserService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.security.Usernames;
import com.gymos.common.util.Names;
import com.gymos.common.util.Contacts;
import java.util.Set;
import com.gymos.common.security.PasswordPolicy;

/**
 * User management service — exact same validations and messages as the Node
 * /api/users endpoints. Persistence is delegated to UserDao (all SQL lives in
 * UserDaoImpl).
 */
@Service
public class UserServiceImpl implements UserService {

    private final UserDao userDao;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;

    public UserServiceImpl(UserDao userDao, PasswordEncoder passwordEncoder, PasswordPolicy passwordPolicy) {
        this.userDao = userDao;
        this.passwordEncoder = passwordEncoder;
        this.passwordPolicy = passwordPolicy;
    }

    @Override
    public List<UserResponse> listAll() {
        return userDao.findAll().stream().map(UserResponse::of).toList();
    }

    /** The only two roles the product has. create() already coerced to these; update() did not. */
    private static final Set<String> ROLES = Set.of("admin", "trainer");

    /**
     * Shape rules shared by create and update.
     *
     * <p>update() took role, email and phone straight from the body: "superadmin"
     * was stored as a role the authorisation checks do not recognise, and
     * "not-an-email" went into the column the reminder queue sends to, where it
     * fails silently for ever. A whitespace-only name passed too, leaving a staff
     * row with no readable name anywhere in the app.
     */
    private void validateProfile(String name, String role, String email, String phone, boolean checkRole) {
        if (name != null && name.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Name cannot be blank.");
        }
        if (checkRole && role != null && !ROLES.contains(role)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "role must be one of: " + String.join(", ", ROLES));
        }
        String emailError = Contacts.emailError(email);
        if (emailError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, emailError);
        String phoneError = Contacts.phoneError(phone, false);
        if (phoneError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, phoneError);
    }

    @Override
    public UserResponse create(String username, String password, String name, String role,
                               String email, String phone) {
        if (username == null || password == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Username and password are required");
        }
        // Stored in the canonical form so that what is typed at the door
        // always matches, whatever a phone keyboard did to the first letter.
        String canonical = Usernames.normalise(username);
        Usernames.validate(canonical);
        passwordPolicy.validateFormat(password);
        // role is deliberately not checked here: create() coerces anything it does
        // not recognise to "trainer" below, and has done since the Node backend.
        validateProfile(name, null, email, phone, false);
        String userRole = "admin".equals(role) ? "admin" : "trainer";
        try {
            User created = userDao.insert(canonical, passwordEncoder.encode(password),
                Names.titleCase(name), userRole, email, phone);
            return UserResponse.of(created);
        } catch (DataIntegrityViolationException e) {
            // A duplicate username is overwhelmingly what lands here, and stays the
            // default. But an over-length name throws the same exception, and
            // reporting that as "username taken" sent the operator off to change a
            // username that was perfectly free. Only a cause that positively names a
            // length problem is redirected — anything unrecognised keeps the 409.
            String detail = String.valueOf(e.getMostSpecificCause().getMessage()).toLowerCase();
            if (detail.contains("too long") || detail.contains("value too long")
                || detail.contains("character varying")) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "One of the values is too long. Check the name, email and phone, then try again.");
            }
            throw new BusinessException(HttpStatus.CONFLICT,
                "Username \"" + canonical + "\" is already taken. Choose another one.");
        }
    }

    @Override
    public UserResponse update(Long id, String name, String role, String email, String phone, String password) {
        // Shape rules run before the lookup, matching the Node backend: a
        // too-short password is a 400 whether or not the user exists.
        if (password != null && !password.isEmpty()) {
            passwordPolicy.validateFormat(password);
        }
        // update() writes the role straight through, so "superadmin" became a role
        // no authorisation check recognises. Checked here, not in create().
        validateProfile(name, role, email, phone, true);
        User existing = userDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "User not found"));

        // An admin setting a password for someone goes through the same policy
        // as a self-service reset — otherwise "you cannot reuse your old
        // password" is one trip to the Users page away from being untrue.
        String hash = null;
        if (password != null && !password.isEmpty()) {
            hash = passwordPolicy.hashForChange(id, password);
        }

        // COALESCE semantics: null keeps the current value.
        userDao.update(id,
            name != null ? Names.titleCase(name) : existing.name(),
            role != null ? role : existing.role(),
            email != null ? email : existing.email(),
            phone != null ? phone : existing.phone(),
            existing.passwordHash());
        if (hash != null) {
            // Owns the password column, the history row and the forced-reset flag.
            userDao.changePassword(id, hash);
        }
        return userDao.findById(id).map(UserResponse::of)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "User not found"));
    }

    @Override
    public void delete(Long id, Long currentUserId) {
        if (id.equals(currentUserId)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "You cannot delete your own account");
        }
        int deleted = userDao.delete(id);
        if (deleted == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "User not found");
        }
    }

    /** "system" and null both mean follow the device; they stay distinct so a
     *  deliberate "match my phone" is not mistaken for "never chose". */
    private static final java.util.Set<String> THEMES = java.util.Set.of("light", "dark", "system");

    @Override
    public String themePreference(Long id) {
        return userDao.findThemePreference(id);
    }

    @Override
    public String setThemePreference(Long id, String theme) {
        String value = theme == null || theme.isBlank() ? null : theme.trim().toLowerCase();
        if (value != null && !THEMES.contains(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Theme must be one of light, dark or system.");
        }
        userDao.updateThemePreference(id, value);
        return value;
    }
}
