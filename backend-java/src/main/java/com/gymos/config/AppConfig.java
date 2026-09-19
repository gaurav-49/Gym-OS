package com.gymos.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Shared application configuration — programmatic transactions for multi-statement
 * operations (e.g. member renumbering, class series creation). The hourly jobs
 * live in SchedulingConfig (see @EnableScheduling there).
 */
@Configuration
public class AppConfig {

    @Bean
    TransactionTemplate transactionTemplate(PlatformTransactionManager txManager) {
        return new TransactionTemplate(txManager);
    }
}
