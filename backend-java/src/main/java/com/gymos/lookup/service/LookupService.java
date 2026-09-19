package com.gymos.lookup.service;

import java.util.List;
import java.util.Map;

/**
 * Master-data lookups service — exceptions and field rules for the frontend
 * validation engine.
 */
public interface LookupService {

    List<Map<String, Object>> listExceptions(String module);
}
