package com.gymos.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables the hourly reminder / auto-renew jobs (mirrors the Node setInterval
 * jobs in app.js). Can be turned off with app.scheduling.enabled=false — the
 * test profile does this so the schedulers never race the integration tests.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(name = "app.scheduling.enabled", havingValue = "true", matchIfMissing = true)
public class SchedulingConfig {
}
