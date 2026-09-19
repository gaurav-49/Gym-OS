package com.gymos.engagement.service;

import java.util.List;
import java.util.Map;

/**
 * Announcements and member feedback.
 *
 * <p>1.0 could message a member only when something happened to their account —
 * a reminder, a receipt, a dunning notice. There was no way to tell the whole
 * gym the boiler is fixed, and no way for a member to say anything back.
 */
public interface EngagementService {

    List<Map<String, Object>> listAnnouncements(String audience, String live, String limit);

    Map<String, Object> createAnnouncement(Map<String, Object> body, Long createdBy);

    Map<String, Object> updateAnnouncement(Long id, Map<String, Object> body);

    Map<String, Object> deleteAnnouncement(Long id);

    List<Map<String, Object>> listFeedback(Long memberId, String category, String from, String limit);

    /** NPS, average score and the promoter/passive/detractor split. */
    Map<String, Object> feedbackSummary(String days);

    Map<String, Object> submitFeedback(Map<String, Object> body, Long memberId);

    Map<String, Object> deleteFeedback(Long id);
}
