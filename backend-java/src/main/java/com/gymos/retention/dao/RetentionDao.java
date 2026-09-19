package com.gymos.retention.dao;

import java.util.List;
import java.util.Map;

/**
 * Churn-risk scoring inputs and the cached results.
 *
 * <p>Risk is stored on the member row rather than joined live: the dashboard
 * reads it on every load, and the attendance scan behind it is far too heavy to
 * run per request.
 */
public interface RetentionDao {

    /**
     * One row per active member with everything the score needs: their visit
     * history in two comparable windows, their own long-run frequency, days to
     * expiry and any outstanding balance.
     */
    List<Map<String, Object>> scoringInputs();

    void saveRisk(Long memberId, int score, String band, String reason,
                  String lastVisitDate, int streak, int bestStreak);

    /** Members currently in a risk band, worst first. */
    List<Map<String, Object>> findByBand(String band, int limit);

    /** How many members sit in each band right now. */
    Map<String, Object> bandCounts();

    /** Stores today's band counts so risk can be charted over time. */
    void snapshotToday(int atRisk, int watch, int healthy, int active);

    List<Map<String, Object>> snapshots(int days);

    /**
     * Raises a follow-up task for a member, deduped by {@code auto_source} so
     * the daily sweep cannot pile up the same task every day.
     *
     * @return true when a new task was actually created
     */
    boolean raiseFollowUpTask(Long memberId, String title, String details, String dueOn, String autoSource);
}
