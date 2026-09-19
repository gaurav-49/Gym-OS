package com.gymos.retention.service;

import java.util.List;
import java.util.Map;

/**
 * Churn prediction — the thing every leading platform competes on and 1.0 had
 * no answer for.
 *
 * <p>The app already knew who had lapsed; it could not tell you who was
 * <em>about to</em>. This scores every active member on how their own recent
 * behaviour compares with their own baseline, and turns the worst cases into
 * dated follow-ups a named person has to action.
 */
public interface RetentionService {

    /** Rescore every active member. Safe to run repeatedly. */
    Map<String, Object> recompute(boolean raiseTasks);

    /** Members in a band (or all scored members), worst first. */
    List<Map<String, Object>> atRisk(String band, String limit);

    /** Band counts now, plus the trend over the last {@code days} days. */
    Map<String, Object> summary(String days);
}
