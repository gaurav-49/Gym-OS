package com.gymos.plans.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;

import com.gymos.plans.dao.PlanDao;

/**
 * The gym's own membership packages, cached for synchronous lookup.
 *
 * <p>1.0 hardcoded Monthly/Quarterly/Half-Yearly/Yearly/Custom in three
 * different places, so a gym that created its own 45-day package got a silent
 * 30-day expiry — the plans master was ignored by the very code that computes
 * memberships. This cache is the single source of truth for "how long is a
 * plan and what does it cost", and {@link com.gymos.common.util.Dates} reads it.
 *
 * <p>Deliberately a static holder, mirroring the Node {@code utils/membership.js}
 * cache: it keeps {@code durationDays()} a plain synchronous call, so the dozens
 * of existing call sites did not have to become async or take a new dependency.
 * It is refreshed at startup and after every plan create/update/delete.
 */
@Service
public class PlanCatalog {

    private static final Logger log = LoggerFactory.getLogger(PlanCatalog.class);

    /** What the app shipped with — still the fallback for an unmigrated database. */
    private static final Map<String, Integer> BUILTIN = Map.of(
        "Monthly", 30, "Quarterly", 90, "Half-Yearly", 180, "Yearly", 365, "Custom", 30);

    /** One cached plan: everything the membership maths needs. */
    public record CachedPlan(String name, int durationDays, BigDecimal price, BigDecimal signupFee) { }

    // Replaced wholesale on refresh, so readers never see a half-built map.
    private static volatile Map<String, CachedPlan> cache = Map.of();

    private final PlanDao planDao;

    public PlanCatalog(PlanDao planDao) {
        this.planDao = planDao;
    }

    @EventListener(ContextRefreshedEvent.class)
    public void init() {
        refresh();
    }

    /** Reload from the plans table. Safe to call on every plan mutation. */
    public void refresh() {
        try {
            Map<String, CachedPlan> next = new LinkedHashMap<>();
            for (Map<String, Object> row : planDao.findPlans(false)) {
                String name = String.valueOf(row.get("name"));
                next.put(name, new CachedPlan(
                    name,
                    ((Number) row.get("duration_days")).intValue(),
                    toDecimal(row.get("price")),
                    toDecimal(row.get("signup_fee"))));
            }
            cache = Map.copyOf(next);
            log.info("loaded {} membership plan(s) into the duration cache", cache.size());
        } catch (Exception e) {
            // A missing plans table (pre-migration) must not stop the server —
            // the built-in names below keep memberships working meanwhile.
            log.warn("could not load the plans master, falling back to the built-in plans: {}", e.getMessage());
        }
    }

    private static BigDecimal toDecimal(Object v) {
        return v instanceof BigDecimal bd ? bd
            : v instanceof Number n ? BigDecimal.valueOf(n.doubleValue())
            : BigDecimal.ZERO;
    }

    /** Every plan name the gym currently sells, or the built-ins before migration. */
    public static List<String> planNames() {
        Map<String, CachedPlan> snapshot = cache;
        return snapshot.isEmpty() ? new ArrayList<>(BUILTIN.keySet()) : new ArrayList<>(snapshot.keySet());
    }

    public static boolean isKnownPlan(String type) {
        return type != null && planNames().contains(type);
    }

    /** Length of a plan in days — the gym's own value, not a hardcoded guess. */
    public static int durationDays(String type) {
        CachedPlan plan = cache.get(type);
        if (plan != null) {
            return plan.durationDays();
        }
        return BUILTIN.getOrDefault(type, 30);
    }

    public static BigDecimal planPrice(String type) {
        CachedPlan plan = cache.get(type);
        return plan == null ? BigDecimal.ZERO : plan.price();
    }

    /** Message shown when a caller sends a plan the gym does not sell. */
    public static String planError(String field) {
        return field + " must be one of: " + String.join(", ", planNames());
    }
}
