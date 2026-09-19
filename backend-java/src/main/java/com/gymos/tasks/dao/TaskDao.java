package com.gymos.tasks.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The staff follow-up queue: where a risk, a due payment or a lead becomes work. */
public interface TaskDao {

    List<Map<String, Object>> findTasks(String status, String category, Long assignedTo,
                                        Long memberId, String due, int limit);

    Optional<Map<String, Object>> findById(Long id);

    Map<String, Object> insert(String title, String details, String category, String priority,
                               String dueOn, Long memberId, Long leadId, Long assignedTo, Long createdBy);

    Optional<Map<String, Object>> update(Long id, String title, String details, String category,
                                         String priority, String status, String dueOn, Long assignedTo,
                                         boolean completing);

    Optional<Map<String, Object>> delete(Long id);

    /** Open / overdue / due-today counts for the header cards. */
    Map<String, Object> counts(Long assignedTo);
}
