package com.gymos.auth.entity;

import java.time.Instant;

/**
 * users row (internal entity). passwordHash never leaves the service layer —
 * the API DTO is {@link com.gymos.auth.dto.UserResponse}.
 */
public record User(Long id, String username, String passwordHash, String name,
                   String role, String email, String phone, Instant createdAt,
                   boolean mustResetPassword) {
}
