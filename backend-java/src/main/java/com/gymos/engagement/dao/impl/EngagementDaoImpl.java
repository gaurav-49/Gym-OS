package com.gymos.engagement.dao.impl;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.gymos.engagement.dao.EngagementDao;

@Repository
public class EngagementDaoImpl implements EngagementDao {

    private final JdbcTemplate jdbc;

    public EngagementDaoImpl(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- announcements -------------------------------------------------------

    @Override
    public List<Map<String, Object>> findAnnouncements(String audience, boolean liveOnly, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (audience != null && !audience.isBlank()) {
            // 'all' posts are for everyone, so an audience filter must include them.
            values.add(audience);
            where.add("(a.audience = ? OR a.audience = 'all')");
        }
        if (liveOnly) {
            where.add("a.publish_on <= CURRENT_DATE");
            where.add("(a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)");
        }
        values.add(limit);
        String sql = """
            SELECT a.*, u.name AS created_by_name,
                   (a.publish_on <= CURRENT_DATE
                     AND (a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)) AS is_live
            FROM announcements a
            LEFT JOIN users u ON u.id = a.created_by"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY a.pinned DESC, a.publish_on DESC, a.id DESC\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Optional<Map<String, Object>> findAnnouncementById(Long id) {
        return jdbc.queryForList("SELECT * FROM announcements WHERE id = ?", id).stream().findFirst();
    }

    @Override
    public Map<String, Object> insertAnnouncement(String title, String body, String audience, boolean pinned,
                                                  String publishOn, String expiresOn, Long createdBy) {
        return jdbc.queryForMap("""
            INSERT INTO announcements (title, body, audience, pinned, publish_on, expires_on, created_by)
            VALUES (?, ?, ?, ?, COALESCE(?::date, CURRENT_DATE), ?::date, ?) RETURNING *""",
            title, body, audience, pinned, publishOn, expiresOn, createdBy);
    }

    @Override
    public Optional<Map<String, Object>> updateAnnouncement(Long id, String title, String body, String audience,
                                                            Boolean pinned, String publishOn, String expiresOn) {
        return jdbc.queryForList("""
            UPDATE announcements SET
                title = COALESCE(?, title), body = COALESCE(?, body),
                audience = COALESCE(?, audience), pinned = COALESCE(?, pinned),
                publish_on = COALESCE(?::date, publish_on), expires_on = COALESCE(?::date, expires_on)
            WHERE id = ? RETURNING *""",
            title, body, audience, pinned, publishOn, expiresOn, id).stream().findFirst();
    }

    @Override
    public Optional<Map<String, Object>> deleteAnnouncement(Long id) {
        return jdbc.queryForList("DELETE FROM announcements WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    // ---- feedback ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> findFeedback(Long memberId, String category, String from, int limit) {
        List<String> where = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        if (memberId != null) {
            values.add(memberId);
            where.add("f.member_id = ?");
        }
        if (category != null && !category.isBlank()) {
            values.add(category);
            where.add("f.category = ?");
        }
        if (from != null && !from.isBlank()) {
            values.add(from);
            where.add("f.created_at >= ?::date");
        }
        values.add(limit);
        String sql = """
            SELECT f.*, c.name AS member_name, c.member_code
            FROM member_feedback f
            LEFT JOIN clients c ON c.id = f.member_id"""
            + (where.isEmpty() ? "" : "\nWHERE " + String.join(" AND ", where))
            + "\nORDER BY f.created_at DESC, f.id DESC\nLIMIT ?";
        return jdbc.queryForList(sql, values.toArray());
    }

    @Override
    public Map<String, Object> insertFeedback(Long memberId, int score, String comment, String category) {
        return jdbc.queryForMap("""
            INSERT INTO member_feedback (member_id, score, comment, category)
            VALUES (?, ?, ?, ?) RETURNING *""", memberId, score, comment, category);
    }

    @Override
    public Optional<Map<String, Object>> deleteFeedback(Long id) {
        return jdbc.queryForList("DELETE FROM member_feedback WHERE id = ? RETURNING *", id)
            .stream().findFirst();
    }

    @Override
    public Map<String, Object> feedbackSummary(int days) {
        // NPS is promoters (9–10) minus detractors (0–6) as a percentage of all
        // responses. 7–8 are "passives" and count only in the denominator.
        return jdbc.queryForMap("""
            SELECT
                COUNT(*)::int                                            AS responses,
                COALESCE(ROUND(AVG(score)::numeric, 2), 0)               AS average,
                COUNT(*) FILTER (WHERE score >= 9)::int                  AS promoters,
                COUNT(*) FILTER (WHERE score BETWEEN 7 AND 8)::int       AS passives,
                COUNT(*) FILTER (WHERE score <= 6)::int                  AS detractors,
                CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(
                    (COUNT(*) FILTER (WHERE score >= 9) - COUNT(*) FILTER (WHERE score <= 6))
                    * 100.0 / COUNT(*), 1) END                            AS nps
            FROM member_feedback
            WHERE created_at >= CURRENT_DATE - ?::int""", days);
    }
}
