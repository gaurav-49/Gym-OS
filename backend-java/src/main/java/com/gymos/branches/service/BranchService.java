package com.gymos.branches.service;

import java.util.List;
import java.util.Map;

/**
 * Branch (location) management.
 *
 * <p>The migration backfilled every existing row to the seeded "Main Branch", so
 * a single-gym install behaves exactly as before and only meets this module when
 * it opens a second location.
 */
public interface BranchService {

    List<Map<String, Object>> list();

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
