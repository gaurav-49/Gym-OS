package com.gymos.lookup.dao;

import java.util.List;
import java.util.Map;

/**
 * Master-data lookups — the exceptions table (validation alerts per module,
 * served by both /api/exceptions and its legacy alias /api/field-rules).
 * All SQL lives in {@link com.gymos.lookup.dao.impl.LookupDaoImpl}.
 */
public interface LookupDao {

    List<Map<String, Object>> listExceptions(String module);
}
