package com.gymos.leads.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.common.util.Contacts;
import com.gymos.common.util.Names;
import com.gymos.leads.dao.LeadDao;
import com.gymos.leads.service.LeadService;
import com.gymos.plans.service.PlanCatalog;
import com.gymos.member.dao.ClientDao;
import com.gymos.member.service.MemberService;

/**
 * Lead service — exact messages/statuses from leadsController.js. The member
 * created on conversion reuses the members module's ClientDao (common code).
 */
@Service
public class LeadServiceImpl implements LeadService {

    private static final List<String> LEAD_STATUSES = List.of("new", "contacted", "visited", "converted", "lost");
    private static final List<String> LEAD_SOURCES = List.of("walk-in", "website", "phone", "social", "referral");
    // 2.0: the plans the gym actually sells, not a hardcoded list. A gym that
    // added its own package could not sell it from the lead form before.

    private final LeadDao leadDao;
    private final ClientDao clientDao;
    private final MemberService memberService;

    public LeadServiceImpl(LeadDao leadDao, ClientDao clientDao, MemberService memberService) {
        this.leadDao = leadDao;
        this.clientDao = clientDao;
        this.memberService = memberService;
    }

    @Override
    public List<Map<String, Object>> list(String status, String source, String search) {
        return leadDao.findLeads(status, source, search);
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body, Long createdBy) {
        String name = Body.str(body, "name");
        if (name == null || name.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Lead name is required");
        }
        // A lead with an unreachable number is a name on a list. The phone is
        // optional — a walk-in may not leave one — but if there is one it has
        // to be a number somebody can actually call.
        String contactError = contactError(body);
        if (contactError != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, contactError);
        }
        String interest = Body.str(body, "interest");
        if (interest != null && !PlanCatalog.isKnownPlan(interest)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                PlanCatalog.planError("interest"));
        }
        String source = Body.str(body, "source");
        if (source != null && !LEAD_SOURCES.contains(source)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "source must be one of: " + String.join(", ", LEAD_SOURCES));
        }
        return leadDao.insert(Names.titleCase(name), Body.str(body, "phone"), Body.str(body, "email"), interest,
            source == null ? "walk-in" : source, Body.str(body, "notes"), createdBy);
    }

    /** @return the message to show, or null when the lead's contacts are usable */
    private static String contactError(Map<String, Object> body) {
        String phone = Contacts.phoneError(Body.str(body, "phone"), false);
        return phone != null ? phone : Contacts.emailError(Body.str(body, "email"));
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String status = Body.str(body, "status");
        if (Body.containsKey(body, "status") && !LEAD_STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", LEAD_STATUSES));
        }
        if (Body.containsKey(body, "phone") || Body.containsKey(body, "email")) {
            String contactError = contactError(body);
            if (contactError != null) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, contactError);
            }
        }
        String interest = Body.str(body, "interest");
        if (Body.containsKey(body, "interest") && interest != null && !interest.isEmpty()
            && !PlanCatalog.isKnownPlan(interest)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                PlanCatalog.planError("interest"));
        }
        String source = Body.str(body, "source");
        if (Body.containsKey(body, "source") && !LEAD_SOURCES.contains(source)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "source must be one of: " + String.join(", ", LEAD_SOURCES));
        }
        return leadDao.update(id,
            Body.containsKey(body, "name") ? Names.titleCase(Body.str(body, "name")) : null,
            Body.containsKey(body, "phone") ? Body.str(body, "phone") : null,
            Body.containsKey(body, "email") ? Body.str(body, "email") : null,
            Body.containsKey(body, "status") ? status : null,
            Body.containsKey(body, "notes") ? Body.str(body, "notes") : null,
            Body.containsKey(body, "interest") ? interest : null,
            Body.containsKey(body, "source") ? source : null);
    }

    @Override
    public Map<String, Object> delete(Long id) {
        if (leadDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Lead not found");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Lead deleted");
        return out;
    }

    @Override
    public Map<String, Object> convert(Long id, Map<String, Object> body) {
        Map<String, Object> lead = leadDao.findById(id)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Lead not found"));
        if ("converted".equals(lead.get("status")) && lead.get("converted_member_id") != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                lead.get("name") + " is already converted — the lead already links to a member.");
        }

        // Two ways in, one outcome. The desk sends member_id: it filled in the
        // onboarding form, the member already exists, and all that is left is
        // to close the enquiry. An API client sends the onboarding fields and
        // they go through MemberService like anybody else's.
        //
        // What is deliberately gone is the third way: building a member here
        // out of whatever the enquiry happened to carry. A lead holds a name
        // and usually a phone, so that produced members with no address, no
        // date of birth and no fee — none of which the onboarding form would
        // have accepted from a walk-in standing at the same desk.
        Long memberId = Body.toLong(body.get("member_id"));
        Map<String, Object> member;
        if (memberId != null) {
            member = clientDao.findById(memberId).orElseThrow(() ->
                new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        } else {
            Map<String, Object> onboarding = new LinkedHashMap<>(body);
            onboarding.putIfAbsent("name", lead.get("name"));
            if (lead.get("phone") != null) onboarding.putIfAbsent("phone", lead.get("phone"));
            if (lead.get("email") != null) onboarding.putIfAbsent("email", lead.get("email"));
            if (lead.get("interest") != null) onboarding.putIfAbsent("membership_type", lead.get("interest"));
            onboarding.putIfAbsent("member_code", String.valueOf(leadDao.nextMemberCode()));
            member = memberService.create(onboarding);
            memberId = toLong(member.get("id"));
        }

        leadDao.markConverted(id, memberId);
        clientDao.logEvent(memberId, "convert",
            "Converted from lead #" + id + " (" + (lead.get("source") == null ? "walk-in" : lead.get("source")) + ")");

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", lead.get("name") + " is now a member — ID " + member.get("member_code")
            + ", " + member.get("membership_type") + " plan valid until " + member.get("membership_expiry") + ".");
        out.put("member", member);
        Map<String, Object> leadOut = new LinkedHashMap<>(lead);
        leadOut.put("status", "converted");
        leadOut.put("converted_member_id", memberId);
        out.put("lead", leadOut);
        return out;
    }

    private static BigDecimal toNum(Object v) {
        if (v == null || (v instanceof String s && s.isEmpty())) return null;
        try {
            return v instanceof BigDecimal bd ? bd : new BigDecimal(String.valueOf(v));
        } catch (NumberFormatException e) {
            return BigDecimal.ONE.negate(); // NaN sentinel → fails the non-negative check
        }
    }

    private static Long toLong(Object v) {
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }
}
