package com.gymos.common.security;

/**
 * Authenticated user derived from the JWT claims — mirrors req.user in the
 * Node backend (id, username, role, name). No DB hit is needed for
 * /api/auth/me, matching the Express implementation.
 */
public record AuthUser(Long id, String username, String role, String name) {
}
