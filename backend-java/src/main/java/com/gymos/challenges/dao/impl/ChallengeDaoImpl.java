package com.gymos.challenges.dao.impl;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.challenges.dao.ChallengeDao;

@Repository
public class ChallengeDaoImpl implements ChallengeDao {

    private final JdbcTemplate jdbc;

    public ChallengeDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public List<Map<String, Object>> findChallenges(String status) {
        String sql = """
            SELECT c.*,
                   (SELECT COUNT(*)::int FROM challenge_participants p WHERE p.challenge_id = c.id) AS participants,
                   (SELECT COUNT(*)::int FROM challenge_participants p
                     WHERE p.challenge_id = c.id AND p.completed_on IS NOT NULL) AS finishers,
                   (c.ends_on < CURRENT_DATE) AS has_ended,
                   (CURRENT_DATE BETWEEN c.starts_on AND c.ends_on) AS is_running,
                   GREATEST(0, c.ends_on - CURRENT_DATE) AS days_left
            FROM challenges c"""
            + (status == null || status.isBlank() ? "" : "\nWHERE c.status = ?")
            + "\nORDER BY (CURRENT_DATE BETWEEN c.starts_on AND c.ends_on) DESC, c.starts_on DESC, c.id DESC";
        return status == null || status.isBlank()
            ? jdbc.queryForList(sql)
            : jdbc.queryForList(sql, status);
    }

    @Override
    public Optional<Map<String, Object>> findById(Long id) {
        return jdbc.queryForList("SELECT * FROM challenges WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insert(String name, String description, String metric, BigDecimal goal,
                                      String unit, String startsOn, String endsOn, String reward,
                                      Long createdBy) {
        return jdbc.queryForMap("""
            INSERT INTO challenges (name, description, metric, goal, unit, starts_on, ends_on, reward, created_by)
            VALUES (?, ?, ?, ?, ?, ?::date, ?::date, ?, ?) RETURNING *""",
            name, description, metric, goal, unit, startsOn, endsOn, reward, createdBy);
    }

    @Override
    public Optional<Map<String, Object>> update(Long id, String name, String description, BigDecimal goal,
                                                String reward, String status) {
        return jdbc.queryForList("""
            UPDATE challenges SET
                name = COALESCE(?, name), description = COALESCE(?, description),
                goal = COALESCE(?, goal), reward = COALESCE(?, reward), status = COALESCE(?, status)
            WHERE id = ? RETURNING *""",
            name, description, goal, reward, status, id).stream().findFirst();
    }

    @Override
    public void delete(Long id) {
        jdbc.update("DELETE FROM challenges WHERE id = ?", id);
    }

    // ---- participants --------------------------------------------------------

    @Override
    public List<Map<String, Object>> leaderboard(Long challengeId, int limit) {
        // RANK, not ROW_NUMBER: two members on the same score genuinely share a
        // place, and showing one of them as 4th would be wrong.
        return jdbc.queryForList("""
            SELECT p.*, c.name AS member_name, c.member_code, c.visit_streak,
                   RANK() OVER (ORDER BY p.progress DESC, p.completed_on NULLS LAST, p.joined_at) AS rank
            FROM challenge_participants p
            JOIN clients c ON c.id = p.member_id
            WHERE p.challenge_id = ?
            ORDER BY rank, c.name
            LIMIT ?""", challengeId, limit);
    }

    @Override
    public Optional<Map<String, Object>> findParticipant(Long challengeId, Long memberId) {
        return jdbc.queryForList(
            "SELECT * FROM challenge_participants WHERE challenge_id = ? AND member_id = ?",
            challengeId, memberId).stream().findFirst();
    }

    @Override
    public Map<String, Object> join(Long challengeId, Long memberId) {
        return jdbc.queryForMap("""
            INSERT INTO challenge_participants (challenge_id, member_id)
            VALUES (?, ?) RETURNING *""", challengeId, memberId);
    }

    @Override
    public void leave(Long challengeId, Long memberId) {
        jdbc.update("DELETE FROM challenge_participants WHERE challenge_id = ? AND member_id = ?",
            challengeId, memberId);
    }

    @Override
    public int countParticipants(Long challengeId) {
        Integer n = jdbc.queryForObject(
            "SELECT COUNT(*)::int FROM challenge_participants WHERE challenge_id = ?",
            Integer.class, challengeId);
        return n == null ? 0 : n;
    }

    @Override
    public int refreshVisitProgress(Long challengeId, String startsOn, String endsOn, BigDecimal goal) {
        // attendance.member_id holds the member CODE, so the join casts through
        // clients.member_code — guarded by the numeric check.
        // completed_on is set once and never moved: the date someone hit the
        // goal is part of the result, and recomputing must not rewrite it.
        return jdbc.update("""
            UPDATE challenge_participants p SET
                progress = v.visits,
                completed_on = CASE
                    WHEN p.completed_on IS NOT NULL THEN p.completed_on
                    WHEN v.visits >= ? THEN CURRENT_DATE
                    ELSE NULL
                END
            FROM (
                SELECT cp.member_id,
                       COUNT(a.id)::numeric AS visits
                FROM challenge_participants cp
                JOIN clients c ON c.id = cp.member_id
                LEFT JOIN attendance a
                       ON c.member_code ~ '^[0-9]+$'
                      AND a.member_id = c.member_code::int
                      AND a.date BETWEEN ?::date AND ?::date
                WHERE cp.challenge_id = ?
                GROUP BY cp.member_id
            ) v
            WHERE p.challenge_id = ? AND p.member_id = v.member_id
              AND (p.progress IS DISTINCT FROM v.visits OR p.completed_on IS NULL)""",
            goal, startsOn, endsOn, challengeId, challengeId);
    }

    @Override
    public boolean memberExists(Long memberId) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*)::int FROM clients WHERE id = ?",
            Integer.class, memberId);
        return n != null && n > 0;
    }
}
