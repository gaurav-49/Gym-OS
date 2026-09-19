package com.gymos.engagement.service.impl;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.engagement.dao.EngagementDao;
import com.gymos.engagement.service.EngagementService;

@Service
public class EngagementServiceImpl implements EngagementService {

    private static final List<String> AUDIENCES = List.of("all", "active", "expiring", "staff");
    private static final List<String> FEEDBACK_CATEGORIES =
        List.of("general", "classes", "trainers", "facilities", "cleanliness", "value");

    private static final int MAX_TITLE = 150;
    private static final int MIN_SCORE = 0;
    private static final int MAX_SCORE = 10;
    private static final int DEFAULT_LIMIT = 100;
    private static final int MAX_LIMIT = 500;
    private static final int DEFAULT_FEEDBACK_DAYS = 90;

    private final EngagementDao engagementDao;
    private final AuditService audit;

    public EngagementServiceImpl(EngagementDao engagementDao, AuditService audit) {
        this.engagementDao = engagementDao;
        this.audit = audit;
    }

    // ---- announcements -------------------------------------------------------

    @Override
    public List<Map<String, Object>> listAnnouncements(String audience, String live, String limit) {
        requireOneOf("audience", audience, AUDIENCES);
        return engagementDao.findAnnouncements(audience, "true".equals(live), clamp(limit));
    }

    @Override
    public Map<String, Object> createAnnouncement(Map<String, Object> body, Long createdBy) {
        String title = Body.str(body, "title");
        if (title == null || title.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Title is required");
        }
        if (title.trim().length() > MAX_TITLE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Title must be " + MAX_TITLE + " characters or fewer");
        }
        String message = Body.str(body, "body");
        if (message == null || message.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Message is required");
        }
        String audience = Body.str(body, "audience");
        requireOneOf("audience", audience, AUDIENCES);

        String publishOn = Body.str(body, "publish_on");
        String expiresOn = Body.str(body, "expires_on");
        requireDate("publish_on", publishOn);
        requireDate("expires_on", expiresOn);
        // An announcement that expires before it publishes is invisible — almost
        // always the two dates entered the wrong way round.
        if (notBlank(publishOn) && notBlank(expiresOn) && expiresOn.compareTo(publishOn) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "expires_on must be on or after publish_on");
        }

        Map<String, Object> announcement = engagementDao.insertAnnouncement(title.trim(), message.trim(),
            blankOr(audience, "all"), Boolean.TRUE.equals(Body.bool(body, "pinned")),
            blankToNull(publishOn), blankToNull(expiresOn), createdBy);
        audit.record("create", "announcements", announcement.get("id"),
            "Posted announcement \"" + announcement.get("title") + "\"");
        return announcement;
    }

    @Override
    public Map<String, Object> updateAnnouncement(Long id, Map<String, Object> body) {
        String title = body.containsKey("title") ? Body.str(body, "title") : null;
        if (body.containsKey("title") && (title == null || title.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Title is required");
        }
        String message = body.containsKey("body") ? Body.str(body, "body") : null;
        if (body.containsKey("body") && (message == null || message.isBlank())) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Message is required");
        }
        String audience = body.containsKey("audience") ? Body.str(body, "audience") : null;
        requireOneOf("audience", audience, AUDIENCES);
        String publishOn = Body.str(body, "publish_on");
        String expiresOn = Body.str(body, "expires_on");
        requireDate("publish_on", publishOn);
        requireDate("expires_on", expiresOn);

        Map<String, Object> updated = engagementDao.updateAnnouncement(id,
            title == null ? null : title.trim(), message == null ? null : message.trim(), audience,
            body.containsKey("pinned") ? Body.bool(body, "pinned") : null,
            blankToNull(publishOn), blankToNull(expiresOn))
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Announcement not found"));
        audit.record("update", "announcements", id,
            "Updated announcement \"" + updated.get("title") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> deleteAnnouncement(Long id) {
        Map<String, Object> announcement = engagementDao.deleteAnnouncement(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Announcement not found"));
        audit.record("delete", "announcements", id,
            "Deleted announcement \"" + announcement.get("title") + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Announcement removed.");
        out.put("announcement", announcement);
        return out;
    }

    // ---- feedback ------------------------------------------------------------

    @Override
    public List<Map<String, Object>> listFeedback(Long memberId, String category, String from, String limit) {
        requireDate("from", from);
        return engagementDao.findFeedback(memberId, category, from, clamp(limit));
    }

    @Override
    public Map<String, Object> feedbackSummary(String days) {
        return engagementDao.feedbackSummary(clampDays(days));
    }

    @Override
    public Map<String, Object> submitFeedback(Map<String, Object> body, Long memberId) {
        Object rawScore = body.get("score");
        if (rawScore == null || String.valueOf(rawScore).isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "score is required (" + MIN_SCORE + "–" + MAX_SCORE + ")");
        }
        int score = Body.toInt(rawScore);
        if (score < MIN_SCORE || score > MAX_SCORE) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "score must be between " + MIN_SCORE + " and " + MAX_SCORE);
        }
        String category = Body.str(body, "category");
        requireOneOf("category", category, FEEDBACK_CATEGORIES);

        // memberId comes from the member's own token when they submit through the
        // portal; staff recording a comment at the desk pass it in the body.
        Long subject = memberId != null ? memberId : Body.toLong(body.get("member_id"));

        Map<String, Object> feedback = engagementDao.insertFeedback(subject, score,
            Body.str(body, "comment"), blankOr(category, "general"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Thanks — your feedback has been recorded.");
        out.put("feedback", feedback);
        return out;
    }

    @Override
    public Map<String, Object> deleteFeedback(Long id) {
        Map<String, Object> feedback = engagementDao.deleteFeedback(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Feedback not found"));
        audit.record("delete", "feedback", id, "Deleted feedback #" + id);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Feedback removed.");
        out.put("feedback", feedback);
        return out;
    }

    // ---- helpers -------------------------------------------------------------

    private static void requireOneOf(String field, String value, List<String> allowed) {
        if (value != null && !value.isBlank() && !allowed.contains(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be one of: " + String.join(", ", allowed));
        }
    }

    private static void requireDate(String field, String value) {
        if (notBlank(value) && !Dates.isValidDateString(value)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                field + " must be a valid date in YYYY-MM-DD format");
        }
    }

    private static boolean notBlank(String v) {
        return v != null && !v.isBlank();
    }

    private static String blankOr(String v, String fallback) {
        return notBlank(v) ? v : fallback;
    }

    private static String blankToNull(String v) {
        return notBlank(v) ? v : null;
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
            return DEFAULT_FEEDBACK_DAYS;
        }
        try {
            return Math.min(730, Math.max(1, Integer.parseInt(raw.trim())));
        } catch (NumberFormatException e) {
            return DEFAULT_FEEDBACK_DAYS;
        }
    }
}
