package com.gymos.audit.service;

import java.util.List;
import java.util.Map;

/** Query side of the audit trail: the log itself plus its filter options. */
public interface AuditLogService {

    List<Map<String, Object>> search(String module, String action, Long userId,
                                     String from, String to, String search, String limit);

    /** Filter options (modules, actions, actors) plus recent activity counts. */
    Map<String, Object> summary();
}
