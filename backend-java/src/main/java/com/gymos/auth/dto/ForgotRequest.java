package com.gymos.auth.dto;

/** POST /api/auth/forgot body: { username, method: 'email' | 'sms' }. */
public record ForgotRequest(String username, String method) {
}
