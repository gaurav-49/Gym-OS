package com.gymos.assessments.service;

import java.util.List;
import java.util.Map;

/**
 * Body-composition assessments.
 *
 * <p>1.0 tracked weight and nothing else, which is the one number that moves for
 * the wrong reasons. This records what a trainer actually reviews with a member —
 * body fat, muscle mass, visceral fat and the girths — and derives BMI so it can
 * never disagree with the height and weight it came from.
 */
public interface AssessmentService {

    List<Map<String, Object>> list(Long memberId, String from, String to, String limit);

    /** A member's full history plus the change since their first and previous assessment. */
    Map<String, Object> memberProgress(Long memberId);

    Map<String, Object> create(Map<String, Object> body, Long assessedBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
