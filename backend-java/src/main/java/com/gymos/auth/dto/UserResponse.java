package com.gymos.auth.dto;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.gymos.auth.entity.User;

/** User shape returned by the /api/users endpoints (created_at matches the Node pg output). */
public record UserResponse(
    Long id,
    String username,
    String name,
    String role,
    String email,
    String phone,
    @JsonProperty("created_at") Instant createdAt) {

    public static UserResponse of(User u) {
        return new UserResponse(u.id(), u.username(), u.name(), u.role(), u.email(), u.phone(), u.createdAt());
    }
}
