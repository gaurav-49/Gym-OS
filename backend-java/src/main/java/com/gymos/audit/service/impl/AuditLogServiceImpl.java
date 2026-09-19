package com.gymos.audit.service.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.audit.dao.AuditDao;
import com.gymos.audit.service.AuditLogService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Dates;

@Service
public class AuditLogServiceImpl implements AuditLogService {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    private final AuditDao auditDao;

    public AuditLogServiceImpl(AuditDao auditDao) {
        this.auditDao = auditDao;
    }

    @Override
    public List<Map<String, Object>> search(String module, String action, Long userId,
                                            String from, String to, String search, String limit) {
        requireDate("from", from);
        requireDate("to", to);
        return auditDao.search(module, action, userId, from, to, search, clampLimit(limit));
    }

    @Override
    public Map<String, Object> summary() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("modules", auditDao.countsByModule());
        out.put("actions", auditDao.countsByAction());
        out.put("actors", auditDao.topActors());
        out.put("counts", auditDao.totals());
        return out;
    }

    private static void requireDate(String field, String value) {
        if (value != null && !value.isBlank() && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    // An unbounded audit query would happily try to serialise a million rows.
    private static int clampLimit(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_LIMIT;
        }
        try {
            int n = Integer.parseInt(raw.trim());
            return Math.min(MAX_LIMIT, Math.max(1, n));
        } catch (NumberFormatException e) {
            return DEFAULT_LIMIT;
        }
    }
}
