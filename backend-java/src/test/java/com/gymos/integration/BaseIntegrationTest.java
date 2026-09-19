package com.gymos.integration;

import java.io.File;
import java.util.List;
import java.util.Map;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.PostgreSQLContainer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration test base — boots the full Spring context (controllers, services,
 * DAOs, security, filters) against a throwaway PostgreSQL running in Docker
 * (Testcontainers), so the suite needs no local database and never touches
 * gymdb. One container is shared by every integration test class.
 *
 * Before every test every table is truncated and db/migrate.js is re-applied,
 * so each test starts from the real 2.0 schema with its master data (exception
 * catalogue, field rules, settings defaults) and nothing else.
 *
 * <p>The schema comes from migrate.js rather than a copy kept for the tests,
 * because that script IS the schema — it creates the 1.0 core and then the 2.0
 * additions. The tests used to apply only the 1.0 half, which meant every
 * login 500'd on the 2.0 columns it writes. A second, hand-maintained copy of
 * the schema would drift from the real one within a release.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class BaseIntegrationTest {

    /** Shared throwaway Postgres — started once per JVM, removed by Testcontainers. */
    private static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:17-alpine");

    static {
        POSTGRES.start();
    }

    /**
     * Applies the project's own migration to the throwaway container.
     *
     * <p>Shelling out to Node is deliberate: {@code db/migrate.js} is where this
     * product's schema lives, and a Java-side copy of it would be a second
     * source of truth that quietly falls behind. {@code scripts/e2e-all.sh}
     * prepares its database exactly the same way.
     */
    private static void migrate() {
        File db = new File("../db");
        try {
            if (!new File(db, "migrate.js").isFile()) {
                throw new IllegalStateException("db/migrate.js not found at " + db.getCanonicalPath());
            }
            ProcessBuilder pb = new ProcessBuilder("node", "migrate.js").directory(db);
            Map<String, String> env = pb.environment();
            // Explicit values win: migrate.js reads a .env only for what the
            // environment has not already set.
            env.put("DB_HOST", POSTGRES.getHost());
            env.put("DB_PORT", String.valueOf(POSTGRES.getMappedPort(5432)));
            env.put("DB_NAME", POSTGRES.getDatabaseName());
            env.put("DB_USER", POSTGRES.getUsername());
            env.put("DB_PASSWORD", POSTGRES.getPassword());
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String output = new String(p.getInputStream().readAllBytes());
            if (p.waitFor() != 0) {
                throw new IllegalStateException("db/migrate.js failed:\n" + output);
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            // A missing Node is the likely cause, and the default message for
            // it ("Cannot run program \"node\"") says nothing about why a test
            // suite wanted one.
            throw new IllegalStateException(
                "Could not apply db/migrate.js to the test database — Node is required to build"
                    + " the schema the integration tests run against.", e);
        }
    }

    @DynamicPropertySource
    static void postgresProperties(DynamicPropertyRegistry registry) {
        // stringtype=unspecified mirrors the Node pg driver (see application.yml).
        // Testcontainers already appends ?loggerLevel=OFF, so join with &.
        registry.add("spring.datasource.url", () -> POSTGRES.getJdbcUrl() + "&stringtype=unspecified");
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired protected MockMvc mvc;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected PasswordEncoder encoder;
    @Autowired protected ObjectMapper om;
    @Autowired protected DataSource dataSource;

    @BeforeEach
    void resetDatabase() {
        // Every table, discovered rather than listed: a hand-kept list silently
        // stops covering a table the day someone adds one, and the leftover
        // rows then surface as a failure in whichever test happens to run next.
        List<String> tables = jdbc.queryForList(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'", String.class);
        if (!tables.isEmpty()) {
            jdbc.update("TRUNCATE " + String.join(", ", tables) + " RESTART IDENTITY CASCADE");
        }
        // Re-apply the schema and its master data — the exception catalogue and
        // settings defaults the tests assert on were just truncated with
        // everything else.
        migrate();
        seedUser("admin", "admin123", "Administrator", "admin", "admin@gym.local", "9990000001");
        seedUser("trainer", "trainer123", "Trainer One", "trainer", "trainer@gym.local", "9990000002");
    }

    private void seedUser(String username, String password, String name, String role,
                          String email, String phone) {
        jdbc.update("INSERT INTO users (username, password_hash, name, role, email, phone) VALUES (?, ?, ?, ?, ?, ?)",
            username, encoder.encode(password), name, role, email, phone);
    }

    protected String loginToken(String username, String password) throws Exception {
        MvcResult res = mvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}"))
            .andExpect(status().isOk())
            .andReturn();
        JsonNode node = om.readTree(res.getResponse().getContentAsString());
        return node.get("token").asText();
    }

    protected String adminToken() throws Exception {
        return loginToken("admin", "admin123");
    }

    protected String trainerToken() throws Exception {
        return loginToken("trainer", "trainer123");
    }
}
