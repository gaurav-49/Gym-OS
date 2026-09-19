package com.gymos.common.security;

import java.io.IOException;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.gymos.common.web.RequestIdFilter;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Common security filter — mirrors backend/src/middleware/auth.js verifyToken:
 * reads the Bearer token and attaches the user to the SecurityContext.
 * Invalid/expired tokens are left unauthenticated so the security entry point
 * answers 401 with the matching message (public routes never reach the entry
 * point, exactly like the Express middleware which only guards protected
 * routes).
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger("auth");

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            try {
                Claims claims = jwtService.parse(header.substring(7));
                Long id = toLong(claims.get("id"));
                // Staff tokens carry `username`; member tokens carry `member_code`
                // (the member's gym-assigned ID) — accept either.
                String username = claims.get("username", String.class);
                if (username == null) username = claims.get("member_code", String.class);
                String role = claims.get("role", String.class);
                String name = claims.get("name", String.class);
                if (username != null && role != null) {
                    AuthUser user = new AuthUser(id, username, role, name);
                    var authentication = new UsernamePasswordAuthenticationToken(
                        user,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + role.toUpperCase())));
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                    log.info("verifyToken :: rid={} ok user={} ({}) → {} {}",
                        RequestIdFilter.idOf(request), id, role, request.getMethod(), request.getRequestURI());
                }
            } catch (Exception ex) {
                log.warn("verifyToken :: rid={} 401 invalid/expired token → {} {}",
                    RequestIdFilter.idOf(request), request.getMethod(), request.getRequestURI());
            }
        }
        chain.doFilter(request, response);
    }

    private static Long toLong(Object value) {
        return value instanceof Number n ? n.longValue() : null;
    }
}
