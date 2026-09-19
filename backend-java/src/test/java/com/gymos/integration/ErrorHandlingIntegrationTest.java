package com.gymos.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class ErrorHandlingIntegrationTest extends BaseIntegrationTest {

    @Test
    void malformedJsonBodyIs400() throws Exception {
        mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{not valid json"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Invalid request body"));
    }

    @Test
    void unknownRouteIs404WithJsonError() throws Exception {
        String token = adminToken();
        mvc.perform(get("/api/does-not-exist").header("Authorization", "Bearer " + token))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("Not found"));
    }

    @Test
    void unknownRouteWithoutTokenIs401First() throws Exception {
        mvc.perform(get("/api/does-not-exist"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void actuatorHealthIsPublicAndUp() throws Exception {
        mvc.perform(get("/actuator/health"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));
    }
}
