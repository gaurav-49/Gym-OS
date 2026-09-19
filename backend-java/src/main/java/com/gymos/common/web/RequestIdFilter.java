package com.gymos.common.web;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Common request-id filter — mirrors backend/src/middleware/requestId.js:
 *  - reuse a sanitized X-Request-ID header, else generate srv-&lt;uuid&gt;
 *  - echo the id back in the X-Request-ID response header
 *  - expose it to every log line via SLF4J MDC ("rid")
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-ID";
    static final String ATTR = RequestIdFilter.class.getName() + ".id";
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9._:-]{1,64}");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String raw = request.getHeader(HEADER);
        String id = (raw != null && VALID_ID.matcher(raw.trim()).matches()) ? raw.trim() : "srv-" + UUID.randomUUID();
        request.setAttribute(ATTR, id);
        response.setHeader(HEADER, id);
        MDC.put("rid", id);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove("rid");
        }
    }

    public static String idOf(HttpServletRequest request) {
        Object id = request.getAttribute(ATTR);
        return id != null ? String.valueOf(id) : "-";
    }
}
