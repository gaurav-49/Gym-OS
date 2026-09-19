package com.gymos.challenges.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.gymos.challenges.dao.ChallengeDao;
import com.gymos.challenges.service.ChallengeService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;

@Service
public class ChallengeServiceImpl implements ChallengeService {

    /**
     * {@code visits} scores itself from attendance. The others are recorded by a
     * trainer, because the app has no way to observe them.
     */
    private static final List<String> METRICS = List.of("visits", "weight_lost", "distance", "points", "custom");
    private static final List<String> STATUSES = List.of("active", "finished", "cancelled");
    private static final String AUTO_METRIC = "visits";

    private static final int DEFAULT_BOARD = 50;
    private static final int MAX_BOARD = 500;

    private final ChallengeDao challengeDao;
    private final AuditService audit;
    private final JdbcTemplate jdbc;

    public ChallengeServiceImpl(ChallengeDao challengeDao, AuditService audit, JdbcTemplate jdbc) {
        this.challengeDao = challengeDao;
        this.audit = audit;
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> list(String status) {
        return challengeDao.findChallenges(status);
    }

    @Override
    public Map<String, Object> get(Long id, String limit) {
        Map<String, Object> challenge = challengeDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));

        // Refresh before reading so the board is never stale when someone opens it.
        if (AUTO_METRIC.equals(String.valueOf(challenge.get("metric")))) {
            refreshBoard(challenge);
        }
        Map<String, Object> out = new LinkedHashMap<>(challenge);
        out.put("leaderboard", challengeDao.leaderboard(id, clampBoard(limit)));
        out.put("participants", challengeDao.countParticipants(id));
        return out;
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long createdBy) {
        String name = Body.str(body, "name");
        if (name == null || name.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Challenge name is required");
        }
        String metric = Body.str(body, "metric");
        if (metric != null && !metric.isBlank() && !METRICS.contains(metric)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "metric must be one of: " + String.join(", ", METRICS));
        }
        BigDecimal goal = Body.toDecimal(body.get("goal"));
        if (goal == null || goal.signum() <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "goal must be greater than 0");
        }
        String startsOn = Body.str(body, "starts_on");
        String endsOn = Body.str(body, "ends_on");
        requireDate("starts_on", startsOn, true);
        requireDate("ends_on", endsOn, true);
        if (endsOn.compareTo(startsOn) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "ends_on must be on or after starts_on");
        }

        Map<String, Object> challenge = challengeDao.insert(name.trim(), Body.str(body, "description"),
            metric == null || metric.isBlank() ? AUTO_METRIC : metric, goal,
            blankOr(Body.str(body, "unit"), AUTO_METRIC), startsOn, endsOn,
            Body.str(body, "reward"), createdBy);
        audit.record("create", "challenges", challenge.get("id"),
            "Created challenge \"" + challenge.get("name") + "\" (" + startsOn + " → " + endsOn + ")");
        return challenge;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        if (status != null && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
        BigDecimal goal = null;
        if (body.get("goal") != null && !String.valueOf(body.get("goal")).isBlank()) {
            goal = Body.toDecimal(body.get("goal"));
            if (goal == null || goal.signum() <= 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "goal must be greater than 0");
            }
        }
        String name = body.containsKey("name") ? Body.str(body, "name") : null;
        if (body.containsKey("name") && (name == null || name.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Challenge name is required");
        }

        Map<String, Object> updated = challengeDao.update(id, name == null ? null : name.trim(),
            body.containsKey("description") ? Body.str(body, "description") : null,
            goal, body.containsKey("reward") ? Body.str(body, "reward") : null, status)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));
        audit.record("update", "challenges", id, "Updated challenge \"" + updated.get("name") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> challenge = challengeDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));
        String name = String.valueOf(challenge.get("name"));

        // A finished challenge is a result members were told about — cancel it
        // rather than deleting the leaderboard out from under them.
        int participants = challengeDao.countParticipants(id);
        if (participants > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + name + "\" has " + participants + " participant(s). Cancel it instead so the"
                    + " leaderboard stays intact.");
        }
        challengeDao.delete(id);
        audit.record("delete", "challenges", id, "Deleted challenge \"" + name + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Challenge \"" + name + "\" deleted.");
        out.put("challenge", challenge);
        return out;
    }

    @Override
    public Map<String, Object> join(Long id, Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        Map<String, Object> challenge = challengeDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));
        if (!"active".equals(String.valueOf(challenge.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + challenge.get("name") + "\" is no longer open to join.");
        }
        if (String.valueOf(challenge.get("ends_on")).compareTo(Dates.todayStr()) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + challenge.get("name") + "\" ended on " + challenge.get("ends_on") + ".");
        }
        if (!challengeDao.memberExists(memberId)) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
        }
        if (challengeDao.findParticipant(id, memberId).isPresent()) {
            throw new BusinessException(HttpStatus.CONFLICT, "That member has already joined this challenge.");
        }

        Map<String, Object> participant = challengeDao.join(id, memberId);
        if (AUTO_METRIC.equals(String.valueOf(challenge.get("metric")))) {
            refreshBoard(challenge);
        }
        audit.record("join", "challenges", id,
            "Member #" + memberId + " joined \"" + challenge.get("name") + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Joined \"" + challenge.get("name") + "\".");
        out.put("participant", participant);
        return out;
    }

    @Override
    public Map<String, Object> leave(Long id, Long memberId) {
        challengeDao.findParticipant(id, memberId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "That member is not in this challenge."));
        challengeDao.leave(id, memberId);
        audit.record("leave", "challenges", id, "Member #" + memberId + " left challenge #" + id);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Removed from the challenge.");
        return out;
    }

    @Override
    public Map<String, Object> refresh(Long id) {
        Map<String, Object> challenge = challengeDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));
        if (!AUTO_METRIC.equals(String.valueOf(challenge.get("metric")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Only visit-based challenges score themselves. Record progress for a \""
                    + challenge.get("metric") + "\" challenge with PUT /progress.");
        }
        int changed = refreshBoard(challenge);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Leaderboard refreshed — " + changed + " participant(s) updated.");
        out.put("updated", changed);
        out.put("leaderboard", challengeDao.leaderboard(id, DEFAULT_BOARD));
        return out;
    }

    private int refreshBoard(Map<String, Object> challenge) {
        return challengeDao.refreshVisitProgress(
            Body.toLong(challenge.get("id")),
            String.valueOf(challenge.get("starts_on")),
            String.valueOf(challenge.get("ends_on")),
            Body.toDecimal(challenge.get("goal")));
    }

    @Override
    public Map<String, Object> setProgress(Long id, Long memberId, Map<String, Object> body) {
        BigDecimal progress = Body.toDecimal(body.get("progress"));
        if (progress == null || progress.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "progress must be a non-negative number");
        }
        Map<String, Object> challenge = challengeDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Challenge not found"));
        if (AUTO_METRIC.equals(String.valueOf(challenge.get("metric")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A visit-based challenge scores itself from attendance — progress cannot be set by hand.");
        }
        challengeDao.findParticipant(id, memberId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "That member is not in this challenge."));

        BigDecimal goal = Body.toDecimal(challenge.get("goal"));
        Map<String, Object> updated = jdbc.queryForMap("""
            UPDATE challenge_participants SET
                progress = ?,
                completed_on = CASE
                    WHEN completed_on IS NOT NULL THEN completed_on
                    WHEN ? >= ? THEN CURRENT_DATE
                    ELSE NULL
                END
            WHERE challenge_id = ? AND member_id = ? RETURNING *""",
            progress, progress, goal, id, memberId);

        audit.record("progress", "challenges", id,
            "Member #" + memberId + " progress " + progress + "/" + goal
                + " in \"" + challenge.get("name") + "\"");
        return updated;
    }

    // ---- helpers -------------------------------------------------------------

    private static void requireDate(String field, String value, boolean required) {
        if (value == null || value.isBlank()) {
            if (required) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, field + " is required");
            }
            return;
        }
        if (!Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static String blankOr(String v, String fallback) {
        return v == null || v.isBlank() ? fallback : v;
    }

    private static int clampBoard(String raw) {
        if (raw == null || raw.isBlank()) {
            return DEFAULT_BOARD;
        }
        try {
            return Math.min(MAX_BOARD, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_BOARD;
        }
    }
}
