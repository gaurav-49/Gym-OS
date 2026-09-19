package com.gymos.auth.dto;

/** GET /api/auth/recovery-options/:username response: { email?, phone? } (masked). */
public record RecoveryOptionsResponse(String email, String phone) {
}
