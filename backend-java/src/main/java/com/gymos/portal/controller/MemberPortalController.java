package com.gymos.portal.controller;

import java.util.Map;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.security.AuthUser;
import com.gymos.portal.service.MemberPortalService;

/**
 * Member self-service portal — mirrors backend/src/routes/memberPortalRoutes.js.
 *
 * <p>/login and the password endpoints are public (each carries its own proof:
 * the current password, or an OTP). /me is protected by the member JWT (role
 * MEMBER), the same token used for class self-service.
 *
 * <p>There is deliberately no check-in endpoint here. A member marking their
 * own attendance needs nothing but their own token, which means it can be done
 * from home and proves nothing about who was at the gym. Attendance is written
 * only by the staff-authenticated scanner in the main app, which requires
 * someone to be standing at the desk with the QR on screen.
 */
@RestController
@RequestMapping("/api/member")
public class MemberPortalController {

    private final MemberPortalService portalService;

    public MemberPortalController(MemberPortalService portalService) {
        this.portalService = portalService;
    }

    private static String str(Map<String, Object> body, String key) {
        Object v = body == null ? null : body.get(key);
        return v == null ? null : String.valueOf(v);
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body) {
        return portalService.login(str(body, "member_code"), str(body, "password"));
    }

    /** Move off the gym default (or any password) by proving the current one. */
    @PostMapping("/change-password")
    public Map<String, Object> changePassword(@RequestBody Map<String, Object> body) {
        return portalService.changePassword(
            str(body, "member_code"), str(body, "current_password"), str(body, "new_password"));
    }

    /** Where a reset OTP can be sent, masked. */
    @GetMapping("/recovery-options")
    public Map<String, Object> recoveryOptions(
            @RequestParam(name = "member_code", required = false) String memberCode) {
        return portalService.recoveryOptions(memberCode);
    }

    /** Send a reset OTP to the registered email or phone. */
    @PostMapping("/forgot")
    public Map<String, Object> forgot(@RequestBody Map<String, Object> body) {
        return portalService.forgot(str(body, "member_code"), str(body, "method"));
    }

    /** Spend the OTP and set a new password. */
    @PostMapping("/verify-otp")
    public Map<String, Object> verifyOtp(@RequestBody Map<String, Object> body) {
        return portalService.verifyOtpReset(
            str(body, "member_code"), str(body, "otp"), str(body, "new_password"));
    }

    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal AuthUser user) {
        return portalService.me(user.id());
    }

    /** Light or dark, stored against the member so it follows them to any
     *  device they sign in on rather than living in one browser. */
    @PutMapping("/preferences")
    public Map<String, Object> setPreferences(@AuthenticationPrincipal AuthUser user,
                                              @RequestBody Map<String, Object> body) {
        return portalService.setThemePreference(user.id(), str(body, "theme"));
    }
}
