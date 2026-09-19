package com.gymos.plans.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.plans.dao.PlanDao;
import com.gymos.plans.service.PlanCatalog;
import com.gymos.plans.service.PlanService;

@Service
public class PlanServiceImpl implements PlanService {

    private static final int MAX_NAME = 80;
    private static final int MAX_DURATION_DAYS = 3650; // ten years — anything more is a typo

    private final PlanDao planDao;
    private final PlanCatalog planCatalog;
    private final AuditService audit;

    public PlanServiceImpl(PlanDao planDao, PlanCatalog planCatalog, AuditService audit) {
        this.planDao = planDao;
        this.planCatalog = planCatalog;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(boolean activeOnly) {
        return planDao.findPlans(activeOnly);
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body) {
        validate(body, false);
        String name = Body.str(body, "name").trim();
        planDao.findByName(name).ifPresent(existing -> {
            throw new BusinessException(HttpStatus.CONFLICT,
                "A plan named \"" + existing.get("name") + "\" already exists.");
        });

        Map<String, Object> plan = planDao.insert(
            name,
            intOf(body, "duration_days", 30),
            decimalOf(body, "price", BigDecimal.ZERO),
            decimalOf(body, "signup_fee", BigDecimal.ZERO),
            Body.str(body, "description"),
            intOf(body, "sort_order", 0),
            !body.containsKey("is_active") || Boolean.TRUE.equals(Body.bool(body, "is_active")));

        planCatalog.refresh();
        audit.record("create", "plans", plan.get("id"),
            "Created plan \"" + plan.get("name") + "\" — " + plan.get("duration_days")
                + " days at ₹" + plan.get("price"));
        return plan;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        validate(body, true);
        Map<String, Object> plan = planDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Plan not found"));

        String currentName = String.valueOf(plan.get("name"));
        String newName = body.containsKey("name") ? Body.str(body, "name").trim() : null;
        int memberCount = planDao.countMembersOn(currentName);

        // The plan name IS the foreign key on clients.membership_type — renaming
        // it while members are on it would silently orphan their membership.
        if (newName != null && !newName.equals(currentName)) {
            if (memberCount > 0) {
                int activeCount = planDao.countActiveMembersOn(currentName);
                String breakdown = activeCount == memberCount
                    ? memberCount + " member(s) are on this plan"
                    : memberCount + " member record(s) name this plan (" + activeCount + " of them active)";
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "Cannot rename \"" + currentName + "\" — " + breakdown
                        + ". Deactivate it and add a new plan instead.");
            }
            planDao.findByName(newName).ifPresent(clash -> {
                throw new BusinessException(HttpStatus.CONFLICT,
                    "A plan named \"" + clash.get("name") + "\" already exists.");
            });
        }

        Map<String, Object> updated = planDao.update(id,
            newName,
            body.containsKey("duration_days") ? intOf(body, "duration_days", 30) : null,
            body.containsKey("price") ? decimalOf(body, "price", BigDecimal.ZERO) : null,
            body.containsKey("signup_fee") ? decimalOf(body, "signup_fee", BigDecimal.ZERO) : null,
            body.containsKey("description") ? Body.str(body, "description") : null,
            body.containsKey("sort_order") ? intOf(body, "sort_order", 0) : null,
            body.containsKey("is_active") ? Body.bool(body, "is_active") : null);

        planCatalog.refresh();
        audit.record("update", "plans", id, "Updated plan \"" + updated.get("name") + "\"");
        return updated;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> plan = planDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Plan not found"));
        String name = String.valueOf(plan.get("name"));

        int memberCount = planDao.countMembersOn(name);
        if (memberCount > 0) {
            // Say which count this is. The page shows active members; this
            // guard counts every member record that names the plan, expired
            // ones included, and quoting the larger number with no explanation
            // read as the two screens disagreeing with each other.
            int activeCount = planDao.countActiveMembersOn(name);
            String breakdown = activeCount == memberCount
                ? memberCount + " member(s) are on this plan"
                : memberCount + " member record(s) name this plan (" + activeCount + " of them active)";
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Cannot delete \"" + name + "\" — " + breakdown
                    + ". Deactivate it instead so it stops being offered to new members.");
        }
        planDao.delete(id);
        planCatalog.refresh();
        audit.record("delete", "plans", id, "Deleted plan \"" + name + "\"");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Plan \"" + name + "\" deleted.");
        out.put("plan", plan);
        return out;
    }

    // ---- validation (same messages as the Node plansController) ----

    private void validate(Map<String, Object> body, boolean partial) {
        if (!partial || body.containsKey("name")) {
            String name = Body.str(body, "name");
            if (name == null || name.isBlank()) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "Plan name is required");
            }
            if (name.trim().length() > MAX_NAME) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "Plan name must be " + MAX_NAME + " characters or fewer");
            }
        }
        if (!partial || body.containsKey("duration_days")) {
            Integer days = rawInt(body.get("duration_days"));
            if (days == null || days < 1 || days > MAX_DURATION_DAYS) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "duration_days must be a whole number between 1 and " + MAX_DURATION_DAYS);
            }
        }
        if (!partial && !hasValue(body, "price")) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "price is required");
        }
        for (String field : List.of("price", "signup_fee")) {
            if (!hasValue(body, field)) {
                continue;
            }
            BigDecimal value = Body.toDecimal(body.get(field));
            if (value == null || value.signum() < 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    field + " must be a non-negative number");
            }
        }
        if (hasValue(body, "sort_order")) {
            Integer order = rawInt(body.get("sort_order"));
            if (order == null || order < 0) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "sort_order must be a non-negative whole number");
            }
        }
    }

    private static boolean hasValue(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v != null && !(v instanceof String s && s.isBlank());
    }

    /** Whole numbers only — 30.5 days is a mistake, not a rounding opportunity. */
    private static Integer rawInt(Object v) {
        if (v == null || (v instanceof String s && s.isBlank())) {
            return null;
        }
        try {
            BigDecimal n = new BigDecimal(String.valueOf(v));
            return n.stripTrailingZeros().scale() > 0 ? null : n.intValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            return null;
        }
    }

    private static int intOf(Map<String, Object> body, String key, int fallback) {
        Integer v = rawInt(body.get(key));
        return v == null ? fallback : v;
    }

    private static BigDecimal decimalOf(Map<String, Object> body, String key, BigDecimal fallback) {
        BigDecimal v = hasValue(body, key) ? Body.toDecimal(body.get(key)) : null;
        return v == null ? fallback : v;
    }
}
