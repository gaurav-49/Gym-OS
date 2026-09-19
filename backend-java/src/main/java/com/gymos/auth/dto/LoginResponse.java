package com.gymos.auth.dto;

import com.gymos.common.security.AuthUser;

/** POST /api/auth/login response: { token, user: { id, username, role, name } }. */
public record LoginResponse(String token, AuthUser user) {
}
