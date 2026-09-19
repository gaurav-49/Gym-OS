package com.gymos.plans.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Membership plans master — the packages the gym sells. */
public interface PlanDao {

    /** @param activeOnly hide plans that are no longer offered to new members */
    List<Map<String, Object>> findPlans(boolean activeOnly);

    Optional<Map<String, Object>> findById(Long id);

    Optional<Map<String, Object>> findByName(String name);

    Map<String, Object> insert(String name, int durationDays, BigDecimal price, BigDecimal signupFee,
                               String description, int sortOrder, boolean isActive);

    Map<String, Object> update(Long id, String name, Integer durationDays, BigDecimal price,
                               BigDecimal signupFee, String description, Integer sortOrder, Boolean isActive);

    void delete(Long id);

    /** How many active members are currently on this plan name. */
    int countMembersOn(String planName);

    /** Of those, the ones still active — so a refusal can say which count it used. */
    int countActiveMembersOn(String planName);
}
