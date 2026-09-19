package com.gymos.challenges.service;

import java.util.List;
import java.util.Map;

/**
 * Challenges and leaderboards.
 *
 * <p>Gamification is what Zen Planner and Trainerize compete on and 1.0 had
 * none of it. A visits-based challenge scores itself straight from the
 * attendance the gym already collects, so the desk sets it up once and never
 * touches it again.
 */
public interface ChallengeService {

    List<Map<String, Object>> list(String status);

    /** The challenge, its leaderboard and the member's own standing. */
    Map<String, Object> get(Long id, String limit);

    Map<String, Object> create(Map<String, Object> body, Long createdBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);

    Map<String, Object> join(Long id, Map<String, Object> body);

    Map<String, Object> leave(Long id, Long memberId);

    /** Rescore a challenge from attendance. Visits-based challenges only. */
    Map<String, Object> refresh(Long id);

    /** Manually set a participant's progress, for metrics the app cannot measure. */
    Map<String, Object> setProgress(Long id, Long memberId, Map<String, Object> body);
}
