package com.gymos.auth.dto;

/** POST /api/auth/login body: { username, password }. */
public record LoginRequest(String username, String password) {
}
