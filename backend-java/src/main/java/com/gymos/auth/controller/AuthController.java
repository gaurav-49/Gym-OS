package com.gymos.auth.controller;

import com.gymos.auth.service.UserService;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.security.access.prepost.PreAuthorize;
import java.util.Map;
import java.util.LinkedHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.auth.dto.ForgotRequest;
import com.gymos.auth.dto.ForgotResponse;
import com.gymos.auth.dto.LoginRequest;
import com.gymos.auth.dto.LoginResponse;
import com.gymos.auth.dto.MessageResponse;
import com.gymos.auth.dto.RecoveryOptionsResponse;
import com.gymos.auth.dto.VerifyOtpRequest;
import com.gymos.auth.service.AuthService;
import com.gymos.common.security.AuthUser;
import com.gymos.common.web.RequestIdFilter;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Auth endpoints — thin controller, all logic in AuthServiceImpl. Same paths
 * as backend/src/routes/authRoutes.js.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger("authController");

    private final AuthService authService;
    private final UserService userService;

    public AuthController(AuthService authService, UserService userService) {
        this.authService = authService;
        this.userService = userService;
    }

    // POST /api/auth/login  { username, password }
    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest req, HttpServletRequest http) {
        LoginResponse response = authService.login(req.username(), req.password());
        log.info("login :: rid={} → ok user={} ({})",
            RequestIdFilter.idOf(http), response.user().id(), response.user().role());
        return response;
    }

    // GET /api/auth/me — answers from the JWT claims, no DB hit (like the Node).
    @GetMapping("/me")
    public AuthUser me(@AuthenticationPrincipal AuthUser user) {
        return user;
    }

    // GET /api/auth/recovery-options/:username (public)
    @GetMapping("/recovery-options/{username}")
    public RecoveryOptionsResponse recoveryOptions(@PathVariable String username) {
        return authService.recoveryOptions(username);
    }

    // POST /api/auth/forgot  { username, method }
    @PostMapping("/forgot")
    public ForgotResponse forgot(@RequestBody ForgotRequest req) {
        return authService.forgot(req.username(), req.method());
    }

    // POST /api/auth/verify-otp  { username, otp, new_password }
    @PostMapping("/verify-otp")
    public MessageResponse verifyOtp(@RequestBody VerifyOtpRequest req) {
        authService.verifyOtpReset(req.username(), req.otp(), req.new_password());
        return new MessageResponse("Password reset successful. You can now log in.");
    }

    // ---- Appearance -------------------------------------------------------
    // Stored against the staff account, not the browser, so the choice follows
    // whoever signs in — the desk machine is shared and localStorage would give
    // the next person on that terminal the last person's theme.
    //
    // These deliberately do NOT live under /api/users: that path is admin-only
    // (SecurityConfig and a class-level @PreAuthorize), and a trainer has to be
    // able to set their own appearance. They also exclude MEMBER explicitly —
    // a member's token carries their clients.id, which would address an
    // unrelated row in users.

    @GetMapping("/preferences")
    @PreAuthorize("!hasRole('MEMBER')")
    public Map<String, Object> preferences(@AuthenticationPrincipal AuthUser user) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("theme_preference", userService.themePreference(user.id()));
        return out;
    }

    @PutMapping("/preferences")
    @PreAuthorize("!hasRole('MEMBER')")
    public Map<String, Object> setPreferences(@AuthenticationPrincipal AuthUser user,
                                              @RequestBody Map<String, Object> body) {
        Object theme = body == null ? null : body.get("theme");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("theme_preference",
            userService.setThemePreference(user.id(), theme == null ? null : String.valueOf(theme)));
        return out;
    }
}
