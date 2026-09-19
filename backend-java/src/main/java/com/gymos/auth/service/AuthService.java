package com.gymos.auth.service;

import com.gymos.auth.dto.ForgotResponse;
import com.gymos.auth.dto.LoginResponse;
import com.gymos.auth.dto.RecoveryOptionsResponse;

/**
 * Auth business logic — port of the Node authController flows (login, recovery
 * options, forgot OTP, verify-otp reset). Implemented by AuthServiceImpl.
 */
public interface AuthService {

    LoginResponse login(String username, String password);

    RecoveryOptionsResponse recoveryOptions(String username);

    ForgotResponse forgot(String username, String method);

    void verifyOtpReset(String username, String otp, String newPassword);
}
