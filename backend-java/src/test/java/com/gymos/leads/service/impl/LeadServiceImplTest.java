package com.gymos.leads.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

import com.gymos.common.api.BusinessException;
import com.gymos.leads.dao.LeadDao;
import com.gymos.leads.service.LeadService;
import com.gymos.member.dao.ClientDao;
import com.gymos.member.service.MemberService;

@ExtendWith(MockitoExtension.class)
class LeadServiceImplTest {

    @Mock LeadDao leadDao;
    @Mock ClientDao clientDao;
    @Mock MemberService memberService;

    private LeadService svc;

    private Map<String, Object> lead() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 1L);
        m.put("name", "Ravi Kumar");
        m.put("phone", "9990000001");
        m.put("email", "ravi@example.com");
        m.put("interest", "Monthly");
        m.put("source", "walk-in");
        m.put("status", "new");
        m.put("converted_member_id", null);
        return m;
    }

    private Map<String, Object> member() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 7L);
        m.put("member_code", "42");
        m.put("name", "Ravi Kumar");
        return m;
    }

    @BeforeEach
    void setUp() {
        svc = new LeadServiceImpl(leadDao, clientDao, memberService);
    }

    @Test
    void createRequiresName() {
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.create(Map.of("phone", "9990000001"), 1L));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("Lead name is required", e.getMessage());
    }

    @Test
    void createDefaultsSourceToWalkIn() {
        svc.create(Map.of("name", "Ravi"), 1L);
        verify(leadDao).insert(eq("Ravi"), eq(null), eq(null), eq(null), eq("walk-in"), eq(null), eq(1L));
    }

    @Test
    void createRejectsBadInterest() {
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.create(Map.of("name", "Ravi", "interest", "Weekly"), 1L));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
    }

    @Test
    void updateRejectsBadStatus() {
        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.update(1L, Map.of("status", "evaporated")));
        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().contains("status must be one of"));
    }

    @Test
    void convertOnboardsThroughTheMemberService() {
        // Converting is onboarding. It used to build a member here out of the
        // lead's name and phone, skipping every rule the onboarding form
        // applies — so a converted member could exist with no address, no date
        // of birth and no fee recorded against them.
        when(leadDao.findById(1L)).thenReturn(Optional.of(lead()));
        when(leadDao.nextMemberCode()).thenReturn(42L);
        when(memberService.create(any())).thenReturn(member());

        Map<String, Object> result = svc.convert(1L, Map.of(
            "membership_fee", 2000, "amount_paid", 2000, "payment_mode", "Cash"));

        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(memberService).create(body.capture());
        // What the enquiry already told us is carried across; what it never
        // knew is whatever the caller supplied.
        assertEquals("Ravi Kumar", body.getValue().get("name"));
        assertEquals("9990000001", body.getValue().get("phone"));
        assertEquals("Monthly", body.getValue().get("membership_type"));
        assertEquals("42", body.getValue().get("member_code"));
        assertEquals(2000, body.getValue().get("membership_fee"));

        verify(leadDao).markConverted(1L, 7L);
        verify(clientDao).logEvent(eq(7L), eq("convert"), any());
    }

    @Test
    void convertLinksAMemberTheDeskAlreadyCreated() {
        // The desk's route: the onboarding form made the member, so converting
        // has nothing left to do but close the enquiry.
        when(leadDao.findById(1L)).thenReturn(Optional.of(lead()));
        when(clientDao.findById(7L)).thenReturn(Optional.of(member()));

        Map<String, Object> result = svc.convert(1L, Map.of("member_id", 7L));

        assertEquals(7L, ((Map<String, Object>) result.get("lead")).get("converted_member_id"));
        verify(leadDao).markConverted(1L, 7L);
        verify(memberService, never()).create(any());
    }

    @Test
    void convertRejectsAMemberIdThatIsNotOne() {
        when(leadDao.findById(1L)).thenReturn(Optional.of(lead()));
        when(clientDao.findById(99L)).thenReturn(Optional.empty());

        BusinessException e = assertThrows(BusinessException.class,
            () -> svc.convert(1L, Map.of("member_id", 99L)));

        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        verify(leadDao, never()).markConverted(any(), any());
    }

    @Test
    void convertAlreadyConvertedReturns400() {
        Map<String, Object> converted = lead();
        converted.put("status", "converted");
        converted.put("converted_member_id", 7L);
        when(leadDao.findById(1L)).thenReturn(Optional.of(converted));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.convert(1L, Map.of()));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertTrue(e.getMessage().contains("already converted"));
        verify(memberService, never()).create(any());
    }
}
