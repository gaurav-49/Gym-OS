package com.gymos.plans.service;

import java.util.List;
import java.util.Map;

/**
 * Membership plans master — the packages the gym sells.
 *
 * <p>{@code clients.membership_type} stores the plan <em>name</em>, so a rename
 * while members are on the plan is refused: it would orphan their membership.
 */
public interface PlanService {

    List<Map<String, Object>> list(boolean activeOnly);

    Map<String, Object> create(Map<String, Object> body);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);
}
