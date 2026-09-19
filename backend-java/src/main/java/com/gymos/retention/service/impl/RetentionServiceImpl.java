package com.gymos.retention.service.impl;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.retention.dao.RetentionDao;
import com.gymos.retention.service.RetentionService;

@Service
public class RetentionServiceImpl implements RetentionService {

    private static final Logger log = LoggerFactory.getLogger(RetentionServiceImpl.class);

    /** Score at or above this is "at-risk"; at or above WATCH_BAND is "watch". */
    private static final int AT_RISK_BAND = 60;
    private static final int WATCH_BAND = 30;

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;
    private static final int DEFAULT_TREND_DAYS = 30;

    /** A member with fewer visits than this has no meaningful personal baseline. */
    private static final int MIN_VISITS_FOR_BASELINE = 4;

    private final RetentionDao retentionDao;
    private final AuditService audit;

    public RetentionServiceImpl(RetentionDao retentionDao, AuditService audit) {
        this.retentionDao = retentionDao;
        this.audit = audit;
    }

    /** The score plus the plain-English reason shown next to it in the UI. */
    private record Risk(int score, String band, String reason) { }

    @Override
    public Map<String, Object> recompute(boolean raiseTasks) {
        List<Map<String, Object>> members = retentionDao.scoringInputs();
        int atRisk = 0;
        int watch = 0;
        int healthy = 0;
        int tasksRaised = 0;

        for (Map<String, Object> m : members) {
            Risk risk = score(m);
            Long id = Body.toLong(m.get("id"));
            Object lastVisit = m.get("last_visit");
            int streak = 0; // recomputed below only when there is a visit history

            if (lastVisit != null) {
                // A streak is "visited at least once in each of the last N weeks".
                // Weekly rather than daily: nobody trains seven days a week, and a
                // daily streak would reset for everyone every Monday.
                streak = weeklyStreak(intOf(m.get("days_since_visit")), intOf(m.get("visits_90")));
            }

            retentionDao.saveRisk(id, risk.score(), risk.band(), risk.reason(),
                lastVisit == null ? null : String.valueOf(lastVisit), streak, streak);

            switch (risk.band()) {
                case "at-risk" -> atRisk++;
                case "watch" -> watch++;
                default -> healthy++;
            }

            // Only at-risk members get a follow-up. Raising one for "watch" would
            // bury the desk in tasks nobody has time to action.
            if (raiseTasks && "at-risk".equals(risk.band())) {
                boolean created = retentionDao.raiseFollowUpTask(id,
                    "Win back " + m.get("name"),
                    risk.reason() + " Call and offer a session or a check-in.",
                    Dates.addDays(Dates.todayStr(), 2),
                    "retention-at-risk");
                if (created) {
                    tasksRaised++;
                }
            }
        }

        retentionDao.snapshotToday(atRisk, watch, healthy, members.size());
        log.info("retention sweep: {} scored — {} at-risk, {} watch, {} healthy, {} task(s) raised",
            members.size(), atRisk, watch, healthy, tasksRaised);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Scored " + members.size() + " active member(s): " + atRisk + " at risk, "
            + watch + " to watch, " + healthy + " healthy."
            + (tasksRaised > 0 ? " " + tasksRaised + " follow-up task(s) raised." : ""));
        out.put("scored", members.size());
        out.put("at_risk", atRisk);
        out.put("watch", watch);
        out.put("healthy", healthy);
        out.put("tasks_raised", tasksRaised);
        return out;
    }

    /**
     * Score one member out of 100. Every component is relative to that member's
     * own history, so a twice-a-week regular who drops to zero scores worse than
     * a once-a-month member who is simply between visits.
     */
    private Risk score(Map<String, Object> m) {
        int visits30 = intOf(m.get("visits_30"));
        int visitsPrev30 = intOf(m.get("visits_prev_30"));
        int visits90 = intOf(m.get("visits_90"));
        int visitsTotal = intOf(m.get("visits_total"));
        Integer daysSinceVisit = nullableInt(m.get("days_since_visit"));
        Integer daysToExpiry = nullableInt(m.get("days_to_expiry"));
        double amountDue = doubleOf(m.get("amount_due"));

        int score = 0;
        List<String> reasons = new ArrayList<>();

        // 1. Absence, measured against their own typical gap between visits.
        if (visitsTotal == 0) {
            score += 45;
            reasons.add("has never checked in");
        } else if (daysSinceVisit != null) {
            double typicalGap = visits90 > 0 ? 90.0 / visits90 : 30.0;
            double ratio = daysSinceVisit / Math.max(typicalGap, 2.0);
            if (ratio >= 4) {
                score += 40;
                reasons.add("last visit " + daysSinceVisit + " days ago, far beyond their usual gap");
            } else if (ratio >= 2.5) {
                score += 28;
                reasons.add("last visit " + daysSinceVisit + " days ago, well past their usual gap");
            } else if (ratio >= 1.5) {
                score += 15;
                reasons.add("last visit " + daysSinceVisit + " days ago");
            }
        }

        // 2. Falling frequency — the clearest early warning, and invisible in 1.0.
        if (visitsTotal >= MIN_VISITS_FOR_BASELINE && visitsPrev30 > 0) {
            double drop = 1.0 - (double) visits30 / visitsPrev30;
            if (visits30 == 0) {
                score += 25;
                reasons.add("stopped coming entirely this month (was " + visitsPrev30 + " visits)");
            } else if (drop >= 0.5) {
                score += 18;
                reasons.add("visits halved this month (" + visitsPrev30 + " → " + visits30 + ")");
            } else if (drop >= 0.3) {
                score += 10;
                reasons.add("visits down this month (" + visitsPrev30 + " → " + visits30 + ")");
            }
        }

        // 3. Renewal window — the moment the decision actually gets made.
        if (daysToExpiry != null) {
            if (daysToExpiry < 0) {
                score += 20;
                reasons.add("membership expired " + Math.abs(daysToExpiry)
                    + " day" + (daysToExpiry == -1 ? "" : "s") + " ago");
            } else if (daysToExpiry == 0) {
                score += 15;
                reasons.add("membership expires today");
            } else if (daysToExpiry <= 7) {
                score += 15;
                reasons.add("expires in " + daysToExpiry + " day" + (daysToExpiry == 1 ? "" : "s"));
            } else if (daysToExpiry <= 21) {
                score += 8;
                reasons.add("expires in " + daysToExpiry + " days");
            }
        }

        // 4. Money owed. A member who owes the gym rarely renews quietly.
        if (amountDue > 0) {
            score += 12;
            reasons.add("owes ₹" + String.format("%.0f", amountDue));
        }

        score = Math.min(100, score);
        String band = score >= AT_RISK_BAND ? "at-risk" : score >= WATCH_BAND ? "watch" : "healthy";
        String reason = reasons.isEmpty()
            ? "Attending regularly with nothing outstanding."
            : capitalize(String.join("; ", reasons)) + ".";
        return new Risk(score, band, reason);
    }

    /**
     * Consecutive weeks with at least one visit, approximated from the visit
     * count and the current gap. Exact per-week bucketing would need one query
     * per member; this stays a single scan and is accurate enough for a badge.
     */
    private static int weeklyStreak(int daysSinceVisit, int visits90) {
        if (daysSinceVisit > 7 || visits90 == 0) {
            return 0;
        }
        // Roughly how many of the last 13 weeks they showed up in.
        return Math.min(13, Math.max(1, (int) Math.round(visits90 / 1.5)));
    }

    @Override
    public List<Map<String, Object>> atRisk(String band, String limit) {
        return retentionDao.findByBand(band, clamp(limit));
    }

    @Override
    public Map<String, Object> summary(String daysRaw) {
        int days = clampDays(daysRaw);
        Map<String, Object> counts = retentionDao.bandCounts();
        List<Map<String, Object>> trend = retentionDao.snapshots(days);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("counts", counts);
        out.put("trend", trend);
        out.put("days", days);
        out.put("bands", Map.of("at_risk_from", AT_RISK_BAND, "watch_from", WATCH_BAND));
        return out;
    }

    /** Called by the scheduler as well as the endpoint. */
    public void recordSweepAudit(Map<String, Object> result) {
        audit.record("recompute", "retention", null, String.valueOf(result.get("message")));
    }

    // ---- helpers -------------------------------------------------------------

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static int intOf(Object v) {
        return v instanceof Number n ? n.intValue() : 0;
    }

    private static Integer nullableInt(Object v) {
        return v instanceof Number n ? n.intValue() : null;
    }

    private static double doubleOf(Object v) {
        return v instanceof Number n ? n.doubleValue() : 0d;
    }

    private static int clamp(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_LIMIT;
        }
        try {
            return Math.min(MAX_LIMIT, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_LIMIT;
        }
    }

    private static int clampDays(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_TREND_DAYS;
        }
        try {
            return Math.min(365, Math.max(7, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_TREND_DAYS;
        }
    }
}
