package com.gymos.notification.service;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Hourly expiry-reminder job — mirror of the Node setInterval in app.js. Safe
 * to run repeatedly: messages are deduped per member + expiry cycle.
 */
@Component
public class NotificationScheduler {

    private static final Logger log = LoggerFactory.getLogger("app");

    private final ReminderService reminderService;

    public NotificationScheduler(ReminderService reminderService) {
        this.reminderService = reminderService;
    }

    @Scheduled(fixedDelay = 60 * 60 * 1000L, initialDelay = 5_000)
    public void run() {
        try {
            Map<String, Object> r = reminderService.runExpiryReminderCheck();
            if (Boolean.TRUE.equals(r.get("enabled")) && (Integer) r.get("members") > 0) {
                log.info("Expiry reminder check: {} expiring, {} reminder(s) sent.",
                    r.get("members"), r.get("sent"));
            }
        } catch (Exception e) {
            log.error("Expiry reminder check failed: {}", e.getMessage(), e);
        }
    }
}
