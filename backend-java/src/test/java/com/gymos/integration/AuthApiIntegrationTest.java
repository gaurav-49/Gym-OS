package com.gymos.integration;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import com.fasterxml.jackson.databind.JsonNode;

class AuthApiIntegrationTest extends BaseIntegrationTest {

    // ---------- login ----------

    @Test
    void loginReturnsTokenAndUser() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.token").isNotEmpty())
            .andExpect(jsonPath("$.user.username").value("admin"))
            .andExpect(jsonPath("$.user.role").value("admin"))
            .andExpect(jsonPath("$.user.name").value("Administrator"))
            .andExpect(jsonPath("$.user.password").doesNotExist());
    }

    @Test
    void loginMissingCredentialsIs400() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Username and password are required"));
    }

    @Test
    void loginUnknownUserIs401() throws Exception {
        // 401, not 404: a 404 here would confirm which usernames exist, for
        // free and in bulk. The message still names the username as the
        // problem — someone who mistyped theirs needs to know that much — but
        // the same failure budget is spent either way, so probing is slow and
        // leaves a trail in login_attempts.
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"nobody\",\"password\":\"x\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error")
                .value("No account found with that username. Please check the spelling and try again."));
    }

    @Test
    void loginWrongPasswordIs401() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"wrong\"}"))
            .andExpect(status().isUnauthorized())
            // The count is deliberate on this branch and absent on the unknown
            // -username one: a real user who mistyped needs to know how much
            // room is left before the account forces a reset.
            .andExpect(jsonPath("$.error").value("Incorrect password. 4 attempt(s) left."));
    }

    // ---------- me ----------

    @Test
    void meReturnsClaimsFromToken() throws Exception {
        String token = adminToken();
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("admin"))
            .andExpect(jsonPath("$.role").value("admin"))
            .andExpect(jsonPath("$.id").value(1));
    }

    @Test
    void meWithoutTokenIs401() throws Exception {
        mvc.perform(get("/api/auth/me"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void meWithInvalidTokenIs401() throws Exception {
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer garbage.token.here"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Invalid or expired token"));
    }

    // ---------- recovery options ----------

    @Test
    void recoveryOptionsMaskContacts() throws Exception {
        mvc.perform(get("/api/auth/recovery-options/admin"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email").value("ad***@gym.local"))
            .andExpect(jsonPath("$.phone").value("99****01"));
    }

    @Test
    void recoveryOptionsForUnknownUserReturnNulls() throws Exception {
        mvc.perform(get("/api/auth/recovery-options/nobody"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.email", nullValue()))
            .andExpect(jsonPath("$.phone", nullValue()));
    }

    // ---------- forgot / OTP ----------

    @Test
    void forgotDeliversConsoleOtpWithDevOtp() throws Exception {
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("OTP sent to your email."))
            .andExpect(jsonPath("$.method").value("email"))
            .andExpect(jsonPath("$.destination_masked").value("ad***@gym.local"))
            .andExpect(jsonPath("$.expires_minutes").value(10))
            .andExpect(jsonPath("$.dev_otp", matchesPattern("\\d{6}")));
    }

    @Test
    void forgotSmsMasksThePhone() throws Exception {
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"sms\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.destination_masked").value("99****01"))
            .andExpect(jsonPath("$.dev_otp", matchesPattern("\\d{6}")));
    }

    @Test
    void forgotRejectsInvalidMethod() throws Exception {
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"fax\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Method must be email or sms"));
    }

    @Test
    void forgotIsHeldOffByTheResendLadder() throws Exception {
        // A flat "five an hour" let someone fire all five in one second. The
        // ladder spaces them instead — a minute after the first, ten after the
        // third — so the second request lands while the first code is still
        // valid and is held off rather than counted.
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.resend_after_seconds").value(60));

        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void verifyOtpFullResetFlow() throws Exception {
        // 1. Request an OTP (console mode -> dev_otp in the response).
        MvcResult forgot = mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isOk())
            .andReturn();
        String otp = om.readTree(forgot.getResponse().getContentAsString()).get("dev_otp").asText();

        // 2. Reset the password with it.
        mvc.perform(post("/api/auth/verify-otp")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"otp\":\"" + otp
                    + "\",\"new_password\":\"brand-new-pass1\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("Password reset successful. You can now log in."));

        // 3. The new password works, the old one does not.
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"brand-new-pass1\"}"))
            .andExpect(status().isOk());
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void verifyOtpWrongCodeReturns401WithRemainingAttempts() throws Exception {
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isOk());

        mvc.perform(post("/api/auth/verify-otp")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"otp\":\"000000\",\"new_password\":\"brand-new-pass1\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Invalid or expired OTP. 4 attempt(s) left."));
    }

    @Test
    void verifyOtpLocksAfterFiveFailedAttempts() throws Exception {
        mvc.perform(post("/api/auth/forgot")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"method\":\"email\"}"))
            .andExpect(status().isOk());

        for (int i = 0; i < 4; i++) {
            mvc.perform(post("/api/auth/verify-otp")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"username\":\"admin\",\"otp\":\"000000\",\"new_password\":\"brand-new-pass1\"}"))
                .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/verify-otp")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"otp\":\"000000\",\"new_password\":\"brand-new-pass1\"}"))
            .andExpect(status().isTooManyRequests())
            .andExpect(jsonPath("$.error",
                containsString("OTP verification is locked for 15 minutes")));
    }

    // ---------- request-id correlation ----------

    @Test
    void xRequestIdHeaderIsEchoedVerbatim() throws Exception {
        mvc.perform(post("/api/auth/login")
                .header("X-Request-ID", "qa-e2e-42")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Request-ID", "qa-e2e-42"));
    }

    @Test
    void xRequestIdIsGeneratedWhenMissing() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Request-ID", matchesPattern("srv-[0-9a-f-]{36}")));
    }

    @Test
    void xRequestIdIsSanitizedWhenInvalid() throws Exception {
        mvc.perform(post("/api/auth/login")
                .header("X-Request-ID", "evil <script> id with spaces")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(header().string("X-Request-ID", matchesPattern("srv-[0-9a-f-]{36}")));
    }

    // ---------- CORS ----------

    @Test
    void corsExposesXRequestIdToTheBrowser() throws Exception {
        mvc.perform(get("/api/auth/recovery-options/admin")
                .header("Origin", "http://localhost:5173"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"))
            .andExpect(header().string("Access-Control-Expose-Headers", containsString("X-Request-ID")));
    }

    @Test
    void corsPreflightAllowsTheApi() throws Exception {
        mvc.perform(options("/api/auth/login")
                .header("Origin", "http://localhost:5173")
                .header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "content-type,x-request-id"))
            .andExpect(status().isOk())
            .andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:5173"));
    }
}
