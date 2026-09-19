package com.gymos.auth.dto;

/** POST /api/users body (admin only). */
public record CreateUserRequest(String username, String password, String name,
                                String role, String email, String phone) {
}
