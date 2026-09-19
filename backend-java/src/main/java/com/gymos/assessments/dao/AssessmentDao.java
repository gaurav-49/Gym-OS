package com.gymos.assessments.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Body-composition assessments: the numbers a trainer actually sells progress on. */
public interface AssessmentDao {

    List<Map<String, Object>> findAssessments(Long memberId, String from, String to, int limit);

    Optional<Map<String, Object>> findById(Long id);

    /** A member's assessments oldest-first, for the progress chart and deltas. */
    List<Map<String, Object>> findForMember(Long memberId);

    Map<String, Object> insert(Map<String, BigDecimal> measures, Long memberId, String assessedOn,
                               Integer restingHr, String notes, Long assessedBy);

    Optional<Map<String, Object>> update(Long id, Map<String, BigDecimal> measures,
                                         Integer restingHr, String notes);

    Optional<Map<String, Object>> delete(Long id);

    boolean memberExists(Long memberId);
}
