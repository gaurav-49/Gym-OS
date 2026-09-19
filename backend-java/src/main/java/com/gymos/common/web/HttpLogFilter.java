package com.gymos.common.web;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * Common HTTP access log — mirrors the Node httpLogger: one line per request
 * with rid, status and duration; warn on 4xx, error on 5xx. Runs after
 * RequestIdFilter so the rid is available.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class HttpLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger("http");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.currentTimeMillis();
        try {
            chain.doFilter(request, response);
        } finally {
            long ms = System.currentTimeMillis() - start;
            int status = response.getStatus();
            String qs = request.getQueryString();
            String line = String.format("rid=%s %s %s%s → %d (%dms)",
                RequestIdFilter.idOf(request),
                request.getMethod(),
                request.getRequestURI(),
                qs != null ? "?" + qs : "",
                status,
                ms);
            if (status >= 500) log.error("request :: {}", line);
            else if (status >= 400) log.warn("request :: {}", line);
            else log.info("request :: {}", line);
        }
    }
}
