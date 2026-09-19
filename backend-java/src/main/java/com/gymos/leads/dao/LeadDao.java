package com.gymos.leads.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Lead (CRM) data access — mirrors the SQL in leadsController.js. All SQL lives
 * in {@link com.gymos.leads.dao.impl.LeadDaoImpl}.
 */
public interface LeadDao {

    List<Map<String, Object>> findLeads(String status, String source, String search);

    Map<String, Object> insert(String name, String phone, String email, String interest,
                               String source, String notes, Long createdBy);

    Map<String, Object> update(Long id, String name, String phone, String email,
                               String status, String notes, String interest, String source);

    Optional<Map<String, Object>> findById(Long id);

    int delete(Long id);

    /** Next free numeric member ID (highest existing numeric code + 1). */
    Long nextMemberCode();

    void markConverted(Long id, Long memberId);
}
