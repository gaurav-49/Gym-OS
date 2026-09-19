package com.gymos.common.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Date;
import java.util.Set;

import javax.crypto.SecretKey;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * Common JWT service (latest jjwt). Same claims as the Node jsonwebtoken sign:
 * { id, username, role, name }, 7-day expiry, HS256.
 *
 * jjwt requires a &gt;= 256-bit key for HS256; the Node backend accepts any string
 * secret, so we derive a fixed 32-byte key via SHA-256(secret). Switching servers
 * invalidates existing sessions (users just log in again — the frontend already
 * handles the 401 → login flow).
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    /** Values that look like a secret but are not — the 1.0 fallback and the documented placeholders. */
    private static final Set<String> REJECTED = Set.of(
        "gym-dev-secret-change-me",
        "change-me-to-a-long-random-string",
        "changeme", "change-me", "secret", "your-secret", "your_jwt_secret", "placeholder");

    private static final int MIN_LENGTH = 32;

    private final SecretKey key;
    private final long expiryMillis;
    private final boolean ephemeral;

    public JwtService(@Value("${app.jwt.secret:}") String secret,
                      @Value("${app.jwt.expiry-days:7}") int expiryDays,
                      Environment environment) {
        String resolved = secret == null ? "" : secret.trim();
        boolean production = environment != null
            && java.util.Arrays.asList(environment.getActiveProfiles()).contains("prod");

        if (resolved.isEmpty() || REJECTED.contains(resolved.toLowerCase())) {
            String why = resolved.isEmpty()
                ? "JWT_SECRET is not set"
                : "JWT_SECRET is a known placeholder (\"" + resolved + "\")";
            if (production) {
                throw new IllegalStateException(why
                    + ". Refusing to start with the 'prod' profile — set JWT_SECRET to a long random string.");
            }
            byte[] random = new byte[48];
            new SecureRandom().nextBytes(random);
            resolved = java.util.HexFormat.of().formatHex(random);
            this.ephemeral = true;
            log.warn("⚠️  {}. Using a random secret generated for this process only — "
                + "every restart signs out all sessions. Set JWT_SECRET to keep logins alive.", why);
        } else {
            this.ephemeral = false;
            if (production && resolved.length() < MIN_LENGTH) {
                throw new IllegalStateException("JWT_SECRET is only " + resolved.length()
                    + " characters. Refusing to start with the 'prod' profile — use at least " + MIN_LENGTH + ".");
            }
            if (resolved.length() < MIN_LENGTH) {
                log.warn("⚠️  JWT_SECRET is short ({} chars). Use at least {} before going live.",
                    resolved.length(), MIN_LENGTH);
            }
        }

        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(resolved.getBytes(StandardCharsets.UTF_8));
            this.key = Keys.hmacShaKeyFor(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
        this.expiryMillis = (long) expiryDays * 24 * 60 * 60 * 1000;
    }

    /** True when the secret was generated at boot, so tokens die with the process. */
    public boolean isEphemeral() {
        return ephemeral;
    }

    /** Staff token — configured expiry (default 7 days). */
    public String sign(AuthUser user) {
        return sign(user, expiryMillis);
    }

    /** Token with an explicit lifetime, e.g. the member portal's 12h session. */
    public String sign(AuthUser user, long ttlMillis) {
        Date now = new Date();
        return Jwts.builder()
            .subject(user.username())
            .claim("id", user.id())
            .claim("username", user.username())
            .claim("role", user.role())
            .claim("name", user.name())
            .issuedAt(now)
            .expiration(new Date(now.getTime() + ttlMillis))
            .signWith(key)
            .compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }
}
