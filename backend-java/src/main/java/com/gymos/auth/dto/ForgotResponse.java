package com.gymos.auth.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * POST /api/auth/forgot response:
 * { message, method, destination_masked, expires_minutes, resend_after_seconds, dev_otp? }.
 *
 * <p>{@code resend_after_seconds} is how long the UI must count down before it
 * re-enables "Resend". It climbs with each send (see the resend ladder in
 * OtpServiceImpl) so the button itself communicates the escalating cost.
 * dev_otp is only present when the OTP was delivered to the console (dev mode).
 */
public record ForgotResponse(
    String message,
    String method,
    @JsonProperty("destination_masked") String destinationMasked,
    @JsonProperty("expires_minutes") int expiresMinutes,
    @JsonProperty("resend_after_seconds") long resendAfterSeconds,
    @JsonInclude(JsonInclude.Include.NON_NULL) @JsonProperty("dev_otp") String devOtp) {
}
