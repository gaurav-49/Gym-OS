package com.gymos.integration;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

class UsersApiIntegrationTest extends BaseIntegrationTest {

    // ---------- authorization ----------

    @Test
    void usersRequireAuthentication() throws Exception {
        mvc.perform(get("/api/users"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("Authentication required"));
    }

    @Test
    void trainersAreForbidden() throws Exception {
        String token = trainerToken();
        mvc.perform(get("/api/users").header("Authorization", "Bearer " + token))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("Insufficient permissions"));
    }

    @Test
    void trainersCannotCreateUsers() throws Exception {
        String token = trainerToken();
        mvc.perform(post("/api/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"sneaky\",\"password\":\"secret1\"}"))
            .andExpect(status().isForbidden());
    }

    // ---------- list ----------

    @Test
    void adminListsUsers() throws Exception {
        String token = adminToken();
        mvc.perform(get("/api/users").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[0].username").value("admin"))
            .andExpect(jsonPath("$[1].username").value("trainer"))
            .andExpect(jsonPath("$[0].password").doesNotExist())
            .andExpect(jsonPath("$[0].password_hash").doesNotExist());
    }

    // ---------- create ----------

    @Test
    void adminCreatesUser() throws Exception {
        String token = adminToken();
        mvc.perform(post("/api/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"newuser\",\"password\":\"secret1\",\"name\":\"New User\","
                    + "\"role\":\"trainer\",\"email\":\"new@gym.local\",\"phone\":\"7770000007\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.username").value("newuser"))
            .andExpect(jsonPath("$.role").value("trainer"))
            .andExpect(jsonPath("$.id").isNumber());
    }

    @Test
    void createDefaultsRoleToTrainer() throws Exception {
        String token = adminToken();
        mvc.perform(post("/api/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"norole\",\"password\":\"secret1\"}"))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.role").value("trainer"));
    }

    @Test
    void createDuplicateUsernameIs409() throws Exception {
        String token = adminToken();
        mvc.perform(post("/api/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"admin\",\"password\":\"secret1\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.error").value("Username \"admin\" is already taken. Choose another one."));
    }

    @Test
    void createMissingPasswordIs400() throws Exception {
        String token = adminToken();
        mvc.perform(post("/api/users")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"nopass\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("Username and password are required"));
    }

    // ---------- update ----------

    @Test
    void adminUpdatesUser() throws Exception {
        String token = adminToken();
        mvc.perform(put("/api/users/2")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Renamed Trainer\",\"role\":\"admin\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("Renamed Trainer"))
            .andExpect(jsonPath("$.role").value("admin"))
            .andExpect(jsonPath("$.username").value("trainer"));
    }

    @Test
    void updateShortPasswordIs400() throws Exception {
        String token = adminToken();
        mvc.perform(put("/api/users/2")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"abc\"}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("New password must be at least 6 characters."));
    }

    @Test
    void updateUnknownUserIs404() throws Exception {
        String token = adminToken();
        mvc.perform(put("/api/users/999")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"Ghost\"}"))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("User not found"));
    }

    // ---------- delete ----------

    @Test
    void adminDeletesUser() throws Exception {
        String token = adminToken();
        mvc.perform(delete("/api/users/2").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("User deleted"));

        // The trainer is gone from the list.
        mvc.perform(get("/api/users").header("Authorization", "Bearer " + token))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$[?(@.username == 'trainer')]").isEmpty());
    }

    @Test
    void adminCannotDeleteOwnAccount() throws Exception {
        String token = adminToken();
        mvc.perform(delete("/api/users/1").header("Authorization", "Bearer " + token))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.error").value("You cannot delete your own account"));
    }

    @Test
    void deleteUnknownUserIs404() throws Exception {
        String token = adminToken();
        mvc.perform(delete("/api/users/999").header("Authorization", "Bearer " + token))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("User not found"));
    }
}
