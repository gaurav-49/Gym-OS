package com.gymos.retention.service;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Nightly churn-risk sweep.
 *
 * <p>Runs every six hours rather than once at midnight so a gym that opens the
 * dashboard mid-afternoon sees numbers from this morning, not yesterday. Each
 * run also writes one snapshot row per day, which is what makes the risk trend
 * chartable.
 *
 * <p>Safe to run repeatedly: scoring is idempotent, the snapshot upserts on the
 * date, and follow-up tasks are deduped by {@code auto_source} while the
 * previous one is still open.
 */
@Component
public class RetentionScheduler {

    private static final Logger log = LoggerFactory.getLogger("app");

    private final RetentionService retentionService;

    public RetentionScheduler(RetentionService retentionService) {
        this.retentionService = retentionService;
    }

    // Offset from the billing job's initial delay so a cold start does not run
    // two full-table scans at the same moment.
    @Scheduled(fixedDelay = 6 * 60 * 60 * 1000L, initialDelay = 15_000)
    public void run() {
        try {
            Map<String, Object> result = retentionService.recompute(true);
            int atRisk = (Integer) result.get("at_risk");
            if (atRisk > 0) {
                log.info("🎯 Retention sweep: {} at risk, {} to watch, {} follow-up task(s) raised.",
                    atRisk, result.get("watch"), result.get("tasks_raised"));
            }
        } catch (Exception e) {
            log.error("Retention sweep failed: {}", e.getMessage(), e);
        }
    }
}
