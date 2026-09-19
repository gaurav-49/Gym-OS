package com.gymos.auth.dto;

/** PUT /api/users/:id body (admin only); null fields keep the current value. */
public record UpdateUserRequest(String name, String role, String email, String phone, String password) {
}
