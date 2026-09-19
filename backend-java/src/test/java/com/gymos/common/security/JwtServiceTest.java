package com.gymos.common.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Date;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import io.jsonwebtoken.Claims;

class JwtServiceTest {

    // A real secret, long enough that no short-secret warning fires.
    private static final String SECRET = "test-secret-that-is-comfortably-long-enough-1234";

    private static MockEnvironment dev() {
        return new MockEnvironment();
    }

    private static MockEnvironment prod() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        return env;
    }

    private final JwtService jwt = new JwtService(SECRET, 7, dev());

    @Test
    void roundTripsTheSameClaims() {
        AuthUser user = new AuthUser(42L, "admin", "admin", "Administrator");
        String token = jwt.sign(user);
        Claims claims = jwt.parse(token);
        assertEquals(42L, ((Number) claims.get("id")).longValue());
        assertEquals("admin", claims.get("username", String.class));
        assertEquals("admin", claims.get("role", String.class));
        assertEquals("Administrator", claims.get("name", String.class));
    }

    @Test
    void exposesExpiryInTheFuture() {
        String token = jwt.sign(new AuthUser(1L, "admin", "admin", "Administrator"));
        assertTrue(jwt.parse(token).getExpiration().after(new Date()));
    }

    @Test
    void rejectsTamperedTokens() {
        String token = jwt.sign(new AuthUser(1L, "admin", "admin", "Administrator"));
        assertThrows(Exception.class, () -> jwt.parse(token + "x"));
    }

    @Test
    void rejectsGarbageToken() {
        assertThrows(Exception.class, () -> jwt.parse("definitely-not-a-jwt"));
    }

    @Test
    void rejectsExpiredTokens() {
        // Negative expiry days -> expiration in the past, invalid immediately.
        JwtService expired = new JwtService(SECRET, -1, dev());
        String token = expired.sign(new AuthUser(1L, "admin", "admin", "Administrator"));
        assertThrows(Exception.class, () -> jwt.parse(token));
    }

    @Test
    void rejectsTokensSignedWithADifferentSecret() {
        JwtService other = new JwtService("a-completely-different-secret-value", 7, dev());
        String token = other.sign(new AuthUser(1L, "admin", "admin", "Administrator"));
        assertThrows(Exception.class, () -> jwt.parse(token));
    }

    // ---- 2.0: no shared default secret --------------------------------------

    @Test
    void aRealSecretIsNotEphemeral() {
        assertFalse(jwt.isEphemeral());
    }

    @Test
    void missingSecretFallsBackToARandomPerProcessKeyInDev() {
        JwtService a = new JwtService("", 7, dev());
        assertTrue(a.isEphemeral(), "a missing secret must not silently reuse a shared default");
    }

    @Test
    void theOldHardcodedFallbackIsTreatedAsUnset() {
        // 1.0 shipped this string in the repository. Anyone could read it and
        // forge an admin token, so it must never be honoured as a real secret.
        JwtService a = new JwtService("gym-dev-secret-change-me", 7, dev());
        assertTrue(a.isEphemeral());
    }

    @Test
    void twoInstancesWithoutASecretCannotReadEachOthersTokens() {
        JwtService a = new JwtService("", 7, dev());
        JwtService b = new JwtService("", 7, dev());
        String token = a.sign(new AuthUser(1L, "admin", "admin", "Administrator"));
        assertThrows(Exception.class, () -> b.parse(token),
            "random per-process secrets must actually differ");
    }

    @Test
    void documentedPlaceholderIsAlsoRejected() {
        assertTrue(new JwtService("change-me-to-a-long-random-string", 7, dev()).isEphemeral());
    }

    @Test
    void productionRefusesToStartWithoutASecret() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> new JwtService("", 7, prod()));
        assertTrue(e.getMessage().contains("JWT_SECRET"), e.getMessage());
    }

    @Test
    void productionRefusesThePlaceholderSecret() {
        assertThrows(IllegalStateException.class,
            () -> new JwtService("gym-dev-secret-change-me", 7, prod()));
    }

    @Test
    void productionRefusesAShortSecret() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
            () -> new JwtService("too-short", 7, prod()));
        assertTrue(e.getMessage().contains("characters"), e.getMessage());
    }

    @Test
    void productionAcceptsALongRealSecret() {
        JwtService prodJwt = new JwtService(SECRET, 7, prod());
        assertFalse(prodJwt.isEphemeral());
        assertNotEquals("", prodJwt.sign(new AuthUser(1L, "a", "admin", "A")));
    }
}
