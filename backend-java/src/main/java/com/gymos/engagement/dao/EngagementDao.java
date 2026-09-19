package com.gymos.engagement.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The member-facing feed (announcements) and what members say back (feedback/NPS). */
public interface EngagementDao {

    // ---- announcements ----

    /** @param liveOnly only what a member should see today */
    List<Map<String, Object>> findAnnouncements(String audience, boolean liveOnly, int limit);

    Optional<Map<String, Object>> findAnnouncementById(Long id);

    Map<String, Object> insertAnnouncement(String title, String body, String audience, boolean pinned,
                                           String publishOn, String expiresOn, Long createdBy);

    Optional<Map<String, Object>> updateAnnouncement(Long id, String title, String body, String audience,
                                                     Boolean pinned, String publishOn, String expiresOn);

    Optional<Map<String, Object>> deleteAnnouncement(Long id);

    // ---- feedback ----

    List<Map<String, Object>> findFeedback(Long memberId, String category, String from, int limit);

    Map<String, Object> insertFeedback(Long memberId, int score, String comment, String category);

    Optional<Map<String, Object>> deleteFeedback(Long id);

    /** NPS and the score distribution over a window. */
    Map<String, Object> feedbackSummary(int days);
}
