package com.gymos.portal.service;

import java.util.Map;

/**
 * Member self-service portal.
 *
 * <p>Authentication is Member ID + <em>password</em>. It used to be Member ID +
 * registered phone, but neither of those is a secret — the ID is printed on the
 * member's own card and the phone number is known to anyone in their contacts.
 *
 * <p>Every member starts on the same gym-wide default password, so the desk can
 * hand over a Member ID and the member is in straight away, and changes it when
 * they choose via {@link #changePassword}. That default is public knowledge by
 * design: what stops it mattering is that the portal is read-mostly. Attendance
 * in particular is <em>not</em> writable from here — it is marked only when
 * staff scan the member's QR in the main app.
 */
public interface MemberPortalService {

    /** Member ID + password. */
    Map<String, Object> login(String memberCode, String password);

    /**
     * Move off the default (or off any password) by proving the current one.
     * Returns a session, so changing a password signs the member straight in
     * rather than bouncing them back to the login screen.
     */
    Map<String, Object> changePassword(String memberCode, String currentPassword, String newPassword);

    /** Masked email/phone the member can have a reset OTP sent to. */
    Map<String, Object> recoveryOptions(String memberCode);

    /** Send a reset OTP to the member's registered email or phone. */
    Map<String, Object> forgot(String memberCode, String method);

    /** Spend a reset OTP and set a new password. */
    Map<String, Object> verifyOtpReset(String memberCode, String otp, String newPassword);

    Map<String, Object> me(Long memberId);

    /** Store light/dark/system for this member so it follows them between devices. */
    Map<String, Object> setThemePreference(Long memberId, String theme);
}
