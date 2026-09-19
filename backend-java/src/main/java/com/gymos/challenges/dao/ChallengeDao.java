package com.gymos.challenges.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Challenges, their participants and the leaderboard. */
public interface ChallengeDao {

    List<Map<String, Object>> findChallenges(String status);

    Optional<Map<String, Object>> findById(Long id);

    Map<String, Object> insert(String name, String description, String metric, BigDecimal goal, String unit,
                               String startsOn, String endsOn, String reward, Long createdBy);

    Optional<Map<String, Object>> update(Long id, String name, String description, BigDecimal goal,
                                         String reward, String status);

    void delete(Long id);

    // ---- participants ----

    /** Ranked participants — the leaderboard itself. */
    List<Map<String, Object>> leaderboard(Long challengeId, int limit);

    Optional<Map<String, Object>> findParticipant(Long challengeId, Long memberId);

    Map<String, Object> join(Long challengeId, Long memberId);

    void leave(Long challengeId, Long memberId);

    int countParticipants(Long challengeId);

    /**
     * Recomputes every participant's progress for a visits-based challenge from
     * the attendance table, and stamps completion once the goal is met.
     *
     * @return how many participants changed
     */
    int refreshVisitProgress(Long challengeId, String startsOn, String endsOn, BigDecimal goal);

    boolean memberExists(Long memberId);
}
