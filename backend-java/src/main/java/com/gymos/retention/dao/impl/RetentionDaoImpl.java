package com.gymos.retention.dao.impl;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.retention.dao.RetentionDao;

@Repository
public class RetentionDaoImpl implements RetentionDao {

    private final JdbcTemplate jdbc;

    public RetentionDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * attendance.member_id holds the gym-assigned member CODE, not clients.id —
     * a 1.0 modelling decision every query here has to respect. The join is
     * guarded by the numeric check so a non-numeric code cannot blow up the cast.
     */
    private static final String ATTENDANCE_JOIN =
        "LEFT JOIN attendance a ON c.member_code ~ '^[0-9]+$' AND a.member_id = c.member_code::int";

    @Override
    public List<Map<String, Object>> scoringInputs() {
        return jdbc.queryForList("""
            SELECT c.id,
                   c.name,
                   c.member_code,
                   c.phone,
                   c.membership_type,
                   c.membership_expiry,
                   c.status,
                   COALESCE(c.amount_due, 0)::float8            AS amount_due,
                   c.join_date,
                   MAX(a.date)                                   AS last_visit,
                   COUNT(a.id) FILTER (WHERE a.date >= CURRENT_DATE - 30)  AS visits_30,
                   COUNT(a.id) FILTER (WHERE a.date >= CURRENT_DATE - 60
                                        AND a.date <  CURRENT_DATE - 30)   AS visits_prev_30,
                   COUNT(a.id) FILTER (WHERE a.date >= CURRENT_DATE - 90)  AS visits_90,
                   COUNT(a.id)                                   AS visits_total,
                   (c.membership_expiry - CURRENT_DATE)          AS days_to_expiry,
                   (CURRENT_DATE - MAX(a.date))                  AS days_since_visit
            FROM clients c
            """ + ATTENDANCE_JOIN + """

            WHERE c.status = 'active'
            GROUP BY c.id
            ORDER BY c.id""");
    }

    @Override
    public void saveRisk(Long memberId, int score, String band, String reason,
                         String lastVisitDate, int streak, int bestStreak) {
        jdbc.update("""
            UPDATE clients SET
                risk_score = ?, risk_band = ?, risk_reason = ?, risk_updated_at = NOW(),
                last_visit_date = ?::date,
                visit_streak = ?,
                best_streak = GREATEST(COALESCE(best_streak, 0), ?)
            WHERE id = ?""",
            score, band, reason, lastVisitDate, streak, bestStreak, memberId);
    }

    @Override
    public List<Map<String, Object>> findByBand(String band, int limit) {
        String where = band == null || band.isBlank()
            ? "c.risk_band IS NOT NULL"
            : "c.risk_band = ?";
        // The keyword before the splice lives in the concatenation, not at the
        // end of the text block: Java strips trailing whitespace from every line
        // of a text block, so "... AND """ + where" silently produced "ANDc.risk_band".
        String sql = """
            SELECT c.id, c.member_code, c.name, c.phone, c.email, c.membership_type,
                   c.membership_expiry, c.risk_score, c.risk_band, c.risk_reason,
                   c.risk_updated_at, c.last_visit_date, c.visit_streak, c.best_streak,
                   COALESCE(c.amount_due, 0)::float8 AS amount_due,
                   t.name AS trainer_name,
                   (SELECT COUNT(*)::int FROM tasks tk
                     WHERE tk.member_id = c.id AND tk.status = 'open') AS open_tasks
            FROM clients c
            LEFT JOIN users t ON t.id = c.trainer_id
            WHERE c.status = 'active'"""
            + " AND " + where
            + " ORDER BY c.risk_score DESC NULLS LAST, c.name LIMIT ?";
        return band == null || band.isBlank()
            ? jdbc.queryForList(sql, limit)
            : jdbc.queryForList(sql, band, limit);
    }

    @Override
    public Map<String, Object> bandCounts() {
        return jdbc.queryForMap("""
            SELECT
                COUNT(*) FILTER (WHERE risk_band = 'at-risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE risk_band = 'watch')::int   AS watch,
                COUNT(*) FILTER (WHERE risk_band = 'healthy')::int AS healthy,
                COUNT(*)::int                                      AS active,
                MAX(risk_updated_at)                               AS last_run
            FROM clients WHERE status = 'active'""");
    }

    @Override
    public void snapshotToday(int atRisk, int watch, int healthy, int active) {
        // One row per day: re-running the sweep refreshes today rather than
        // stacking duplicates, so the trend line stays one point per date.
        jdbc.update("""
            INSERT INTO retention_snapshots (snapshot_on, at_risk, watch, healthy, active)
            VALUES (CURRENT_DATE, ?, ?, ?, ?)
            ON CONFLICT (snapshot_on) DO UPDATE SET
                at_risk = EXCLUDED.at_risk, watch = EXCLUDED.watch,
                healthy = EXCLUDED.healthy, active = EXCLUDED.active""",
            atRisk, watch, healthy, active);
    }

    @Override
    public List<Map<String, Object>> snapshots(int days) {
        return jdbc.queryForList("""
            SELECT snapshot_on, at_risk, watch, healthy, active
            FROM retention_snapshots
            WHERE snapshot_on >= CURRENT_DATE - ?::int
            ORDER BY snapshot_on""", days);
    }

    @Override
    public boolean raiseFollowUpTask(Long memberId, String title, String details,
                                     String dueOn, String autoSource) {
        // The partial unique index on (member_id, auto_source) WHERE status='open'
        // makes this a no-op when the previous sweep's task is still open.
        int inserted = jdbc.update("""
            INSERT INTO tasks (title, details, category, priority, due_on, member_id, auto_source)
            VALUES (?, ?, 'retention', 'high', ?::date, ?, ?)
            ON CONFLICT DO NOTHING""",
            title, details, dueOn, memberId, autoSource);
        return inserted > 0;
    }
}
