package com.gymos.billing.service;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Hourly auto-renew job — mirror of the Node setInterval in app.js. Safe to
 * run repeatedly: successes and scheduled retries are skipped, retries fire
 * only when due.
 */
@Component
public class BillingScheduler {

    private static final Logger log = LoggerFactory.getLogger("app");

    private final BillingService billingService;

    public BillingScheduler(BillingService billingService) {
        this.billingService = billingService;
    }

    @Scheduled(fixedDelay = 60 * 60 * 1000L, initialDelay = 7_000)
    public void run() {
        try {
            Map<String, Object> b = billingService.runAutoRenewCheck();
            if (Boolean.TRUE.equals(b.get("enabled")) && (Integer) b.get("due") > 0) {
                log.info("Auto-renew check: {} due, {} renewed, {} failed.",
                    b.get("due"), b.get("renewed"), b.get("failed"));
            }
        } catch (Exception e) {
            log.error("Auto-renew check failed: {}", e.getMessage(), e);
        }
    }
}
