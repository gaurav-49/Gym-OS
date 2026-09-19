package com.gymos.tasks.service;

import java.util.List;
import java.util.Map;

/**
 * Staff follow-up queue.
 *
 * <p>1.0 could tell you a member was at risk, a payment was due or a lead had
 * gone cold — but there was nowhere for that to become somebody's job. Tasks
 * close that gap, and the retention sweep raises them automatically.
 */
public interface TaskService {

    List<Map<String, Object>> list(String status, String category, Long assignedTo,
                                   Long memberId, String due, String limit);

    Map<String, Object> create(Map<String, Object> body, Long createdBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);

    Map<String, Object> counts(Long assignedTo);
}
