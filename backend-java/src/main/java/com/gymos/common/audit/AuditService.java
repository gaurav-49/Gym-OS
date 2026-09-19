package com.gymos.common.audit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import com.gymos.common.security.AuthUser;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Writes the staff action trail that the Audit Log page reads.
 *
 * <p>Mirrors the Node {@code utils/audit.js}: it never throws. An audit write
 * that fails must not roll back or 500 the business action the user actually
 * asked for — the failure is logged and swallowed.
 *
 * <p>Rows carry the same {@code rid} as the HTTP and controller logs, so an
 * entry on the Audit page can be traced straight back to the server log lines
 * for that one request.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private static final int SUMMARY_MAX = 255;

    private final JdbcTemplate jdbc;
    private final HttpServletRequest request;

    public AuditService(JdbcTemplate jdbc, HttpServletRequest request) {
        this.jdbc = jdbc;
        this.request = request;
    }

    /**
     * Record one staff action.
     *
     * @param action   create / update / delete / assign / sell / cancel …
     * @param module   the module page the action belongs to
     * @param entityId the row acted on (may be null for bulk actions)
     * @param summary  one human sentence — this is what the Audit page shows
     */
    public void record(String action, String module, Object entityId, String summary) {
        try {
            AuthUser user = currentUser();
            jdbc.update("""
                INSERT INTO audit_log (user_id, username, action, module, entity_id, summary, request_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)""",
                user == null ? null : user.id(),
                user == null ? null : user.username(),
                action,
                module,
                entityId == null ? null : String.valueOf(entityId),
                truncate(summary),
                requestId());
        } catch (Exception e) {
            // Deliberately swallowed — see the class comment.
            log.warn("audit write failed for {}/{}: {}", module, action, e.getMessage());
        }
    }

    private static String truncate(String summary) {
        if (summary == null) {
            return null;
        }
        return summary.length() <= SUMMARY_MAX ? summary : summary.substring(0, SUMMARY_MAX);
    }

    private String requestId() {
        try {
            Object id = request.getAttribute("rid");
            if (id != null) {
                return String.valueOf(id);
            }
            return request.getHeader("X-Request-ID");
        } catch (Exception e) {
            return null;
        }
    }

    private static AuthUser currentUser() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof AuthUser user) {
            return user;
        }
        return null;
    }
}
