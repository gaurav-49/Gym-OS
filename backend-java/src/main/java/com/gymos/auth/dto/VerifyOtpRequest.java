package com.gymos.auth.dto;

/** POST /api/auth/verify-otp body: { username, otp, new_password }. */
public record VerifyOtpRequest(String username, String otp, String new_password) {
}
