package com.gymos.common.config;

import java.io.IOException;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import com.gymos.common.api.ApiError;
import com.gymos.common.security.JwtAuthFilter;

import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.ObjectMapper;

/**
 * Shared Spring Security configuration (Spring Security 7): stateless JWT auth,
 * URL-level role rules + method security, JSON 401/403 responses that mirror the
 * Node middleware/auth.js messages.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    // Public routes — everything else under /api requires a valid JWT.
    //  - /api/device/punch: the fingerprint terminal cannot log in, it just
    //    posts punches (restrict at the network layer in production).
    //  - /api/member/login + /api/member/classes/verify: member self-service
    //    handshake (Member ID + password → short-lived member JWT).
    //  - GET /api/branding: the gym's own name and logo, needed by the login
    //    screen before anyone has signed in. Read-only; the PUT is admin-gated
    //    on the controller.
    private static final String[] PUBLIC_PATHS = {
        "/api/auth/login",
        "/api/auth/recovery-options/**",
        "/api/auth/forgot",
        "/api/auth/verify-otp",
        "/api/device/punch",
        "/api/member/login",
        "/api/member/classes/verify",
        // Password self-service. Public because the member who needs it most
        // is the one who cannot sign in — each endpoint carries its own proof
        // instead: the current password, or an OTP sent to the number on file.
        "/api/member/change-password",
        "/api/member/recovery-options",
        "/api/member/forgot",
        "/api/member/verify-otp",
    };

    /** Public for GET only — PUT /api/branding stays behind the admin guard. */
    private static final String[] PUBLIC_GET_PATHS = {
        "/api/branding",
    };

    private final ObjectMapper objectMapper;

    public SecurityConfig(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, JwtAuthFilter jwtAuthFilter) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(PUBLIC_PATHS).permitAll()
                .requestMatchers(org.springframework.http.HttpMethod.GET, PUBLIC_GET_PATHS).permitAll()
                // The bundled React UI (static resources) is public — the SPA
                // performs its own auth with the JWT stored in localStorage.
                .requestMatchers("/", "/index.html", "/assets/**", "/favicon.*").permitAll()
                .requestMatchers("/api/users/**").hasRole("ADMIN")
                // Member portal + member class self-service are member-only
                // (staff tokens carry role admin/trainer and are rejected here).
                .requestMatchers("/api/member/**").hasRole("MEMBER")
                .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                .anyRequest().authenticated())
            // Per-route admin/trainer guards mirror the Node requireRole() calls
            // and are enforced with @PreAuthorize on the controllers.
            .exceptionHandling(e -> e
                .authenticationEntryPoint(restAuthenticationEntryPoint())
                .accessDeniedHandler(restAccessDeniedHandler()))
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** Shared BCrypt encoder used by every module's service layer. */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    // 401 JSON, mirroring middleware/auth.js verifyToken:
    //   no Authorization header      -> "Authentication required"
    //   header present but rejected  -> "Invalid or expired token"
    private AuthenticationEntryPoint restAuthenticationEntryPoint() {
        return (request, response, authException) -> {
            String message = request.getHeader("Authorization") != null
                ? "Invalid or expired token"
                : "Authentication required";
            writeError(response, HttpStatus.UNAUTHORIZED, message);
        };
    }

    // 403 JSON for role violations, mirroring requireRole().
    private AccessDeniedHandler restAccessDeniedHandler() {
        return (request, response, accessDeniedException) ->
            writeError(response, HttpStatus.FORBIDDEN, "Insufficient permissions");
    }

    private void writeError(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), new ApiError(message));
    }
}
