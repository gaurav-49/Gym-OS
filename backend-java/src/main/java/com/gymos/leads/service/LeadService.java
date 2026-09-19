package com.gymos.leads.service;

import java.util.List;
import java.util.Map;

/**
 * Lead management (CRM) — mirrors leadsController.js: pipeline tracking and
 * one-click conversion of a lead into a full member.
 */
public interface LeadService {

    List<Map<String, Object>> list(String status, String source, String search);

    Map<String, Object> create(Map<String, Object> body, Long createdBy);

    Map<String, Object> update(Long id, Map<String, Object> body);

    Map<String, Object> delete(Long id);

    Map<String, Object> convert(Long id, Map<String, Object> body);
}
