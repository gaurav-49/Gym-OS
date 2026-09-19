package com.gymos.classes.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.classes.dao.ClassDao;
import com.gymos.classes.service.ClassService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.security.JwtService;
import com.gymos.member.dao.ClientDao;
import com.gymos.portal.service.MemberPortalService;

@ExtendWith(MockitoExtension.class)
class ClassServiceImplTest {

    @Mock ClassDao classDao;
    @Mock com.gymos.notify.service.NotifyService notifyService;
    @Mock com.gymos.portal.service.MemberPortalService memberPortalService;
    @Mock ClientDao clientDao;
    @Mock JwtService jwtService;
    @Mock TransactionTemplate tx;

    private ClassService svc;

    private Map<String, Object> activeClass(int capacity) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 1L);
        m.put("name", "Morning Yoga");
        m.put("status", "active");
        m.put("capacity", capacity);
        return m;
    }

    private Map<String, Object> bookableMember() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", 5L);
        m.put("member_code", "101");
        m.put("name", "Alice");
        m.put("status", "active");
        m.put("membership_expiry", "2099-01-01");
        m.put("frozen_until", null);
        m.put("phone", "9990000001");
        return m;
    }

    @BeforeEach
    void setUp() {
        svc = new ClassServiceImpl(classDao, clientDao, jwtService, tx,
            com.gymos.common.security.TestThrottles.open(),
            new org.springframework.mock.web.MockHttpServletRequest(),
            notifyService, memberPortalService);
    }

    private static Map<String, Object> counts(int booked, int waitlisted) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("booked", booked);
        m.put("waitlisted", waitlisted);
        return m;
    }

    // ---------- booking core ----------

    @Test
    void bookAddsToBookedWhenCapacityAvailable() {
        when(classDao.findById(1L)).thenReturn(Optional.of(activeClass(10)));
        when(classDao.findMemberBookable(5L)).thenReturn(Optional.of(bookableMember()));
        when(classDao.findActiveBooking(1L, 5L)).thenReturn(Optional.empty());
        when(classDao.counts(1L)).thenReturn(counts(5, 0));

        Map<String, Object> result = svc.book(1L, 5L);

        assertEquals("booked", result.get("status"));
        assertEquals("Morning Yoga", result.get("className"));
        verify(classDao).upsertBooking(1L, 5L, "booked");
    }

    @Test
    void bookWaitlistsWhenClassIsFull() {
        when(classDao.findById(1L)).thenReturn(Optional.of(activeClass(5)));
        when(classDao.findMemberBookable(5L)).thenReturn(Optional.of(bookableMember()));
        when(classDao.findActiveBooking(1L, 5L)).thenReturn(Optional.empty());
        when(classDao.counts(1L)).thenReturn(counts(5, 0));

        Map<String, Object> result = svc.book(1L, 5L);

        assertEquals("waitlisted", result.get("status"));
        verify(classDao).upsertBooking(1L, 5L, "waitlisted");
    }

    @Test
    void bookDuplicateReturns409() {
        when(classDao.findById(1L)).thenReturn(Optional.of(activeClass(10)));
        when(classDao.findMemberBookable(5L)).thenReturn(Optional.of(bookableMember()));
        when(classDao.findActiveBooking(1L, 5L)).thenReturn(Optional.of(Map.of("status", "booked")));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.book(1L, 5L));

        assertEquals(HttpStatus.CONFLICT, e.getStatus());
        assertEquals("Member is already booked for this class.", e.getMessage());
        verify(classDao, never()).upsertBooking(anyLong(), anyLong(), anyString());
    }

    @Test
    void bookCancelledClassReturns400() {
        Map<String, Object> cancelled = activeClass(10);
        cancelled.put("status", "cancelled");
        when(classDao.findById(1L)).thenReturn(Optional.of(cancelled));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.book(1L, 5L));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("This class has been cancelled.", e.getMessage());
    }

    @Test
    void bookUnknownMemberReturns404() {
        when(classDao.findById(1L)).thenReturn(Optional.of(activeClass(10)));
        when(classDao.findMemberBookable(5L)).thenReturn(Optional.empty());

        BusinessException e = assertThrows(BusinessException.class, () -> svc.book(1L, 5L));

        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
    }

    @Test
    void bookExpiredMemberReturns400() {
        Map<String, Object> member = bookableMember();
        member.put("membership_expiry", "2020-01-01");
        when(classDao.findById(1L)).thenReturn(Optional.of(activeClass(10)));
        when(classDao.findMemberBookable(5L)).thenReturn(Optional.of(member));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.book(1L, 5L));

        assertEquals(HttpStatus.BAD_REQUEST, e.getStatus());
        assertEquals("Membership for Alice expired on 2020-01-01. Renew to book classes.", e.getMessage());
    }

    // ---------- cancel + waitlist promotion ----------

    @Test
    void cancelPromotesEarliestWaitlistedMember() {
        when(classDao.cancelBooking(1L, 5L)).thenReturn(1);
        when(classDao.firstWaitlisted(1L)).thenReturn(Optional.of(Map.of("id", 9L)));
        when(classDao.promoteWaitlisted(9L)).thenReturn(Optional.of(7L));
        when(classDao.findMemberName(7L)).thenReturn(Optional.of("Bob"));

        Map<String, Object> result = svc.cancelBooking(1L, 5L);

        assertEquals("Bob", result.get("promoted"));
        verify(classDao).promoteWaitlisted(9L);
    }

    @Test
    void cancelWithoutActiveBookingReturns404() {
        when(classDao.cancelBooking(1L, 5L)).thenReturn(0);

        BusinessException e = assertThrows(BusinessException.class, () -> svc.cancelBooking(1L, 5L));

        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertEquals("No active booking found for this member in this class.", e.getMessage());
    }

    // ---------- member verification ----------

    // The booking page's sign-in is no longer a second, weaker credential
    // check — it delegates to the member portal, so both doors share one lock.
    // The behaviour itself is covered by MemberPortalServiceImplTest.

    @Test
    void verifyMemberDelegatesToTheMemberPortalLogin() {
        Map<String, Object> session = Map.of("token", "member-tok", "member_code", "101");
        when(memberPortalService.login("101", "s3cret")).thenReturn(session);

        Map<String, Object> result = svc.verifyMember("101", "s3cret");

        assertEquals("member-tok", result.get("token"));
        verify(memberPortalService).login("101", "s3cret");
        // No parallel credential path of its own.
        verify(clientDao, org.mockito.Mockito.never()).findByMemberCodeFull(org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void verifyMemberPropagatesThePortalRejection() {
        when(memberPortalService.login("101", "wrong"))
            .thenThrow(new BusinessException(HttpStatus.UNAUTHORIZED, "Incorrect password. 4 attempt(s) left."));

        BusinessException e = assertThrows(BusinessException.class, () -> svc.verifyMember("101", "wrong"));

        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
    }
}
