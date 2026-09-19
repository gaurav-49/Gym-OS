package com.gymos.audit.dao;

import java.util.List;
import java.util.Map;

/**
 * Read side of the staff action trail. There is deliberately no insert here —
 * rows are written by {@link com.gymos.common.audit.AuditService} from each
 * module's write path, and an audit log an operator can rewrite is not an
 * audit log.
 */
public interface AuditDao {

    List<Map<String, Object>> search(String module, String action, Long userId,
                                     String from, String to, String search, int limit);

    List<Map<String, Object>> countsByModule();

    List<Map<String, Object>> countsByAction();

    List<Map<String, Object>> topActors();

    Map<String, Object> totals();
}
