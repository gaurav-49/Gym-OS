package com.gymos.otp.dao.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.gymos.otp.dao.OtpDao;
import com.gymos.otp.service.OtpService;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class OtpDaoImplTest {

    @Mock JdbcTemplate jdbc;

    private OtpDao dao;

    @BeforeEach
    void setUp() {
        dao = new OtpDaoImpl(jdbc);
    }

    @Test
    void insertResetInsertsHashedOtpWithExpiry() {
        Instant expires = Instant.parse("2026-01-01T00:10:00Z");
        dao.insertReset(OtpService.STAFF, 1L, "abc123hash", "email", expires);
        // The Instant is converted to a Timestamp at the DAO boundary (the pg
        // driver cannot bind java.time.Instant directly).
        verify(jdbc).update(anyString(), eq(OtpService.STAFF), eq(1L), eq("abc123hash"), eq("email"),
            eq(Timestamp.from(expires)));
    }

    @Test
    void findValidResetIdReturnsNewestUnusedUnexpiredRow() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L), eq("abc123hash")))
            .thenReturn(List.of(9L));
        assertEquals(Optional.of(9L), dao.findValidResetId(OtpService.STAFF, 1L, "abc123hash"));
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L), eq("nope")))
            .thenReturn(List.of());
        assertEquals(Optional.empty(), dao.findValidResetId(OtpService.STAFF, 1L, "nope"));
    }

    @Test
    void anOtpIssuedToAMemberDoesNotUnlockTheStaffAccountWithTheSameId() {
        // users.id and clients.id are independent sequences, so member 1 and
        // staff 1 both exist. Without the scope in the predicate, the member's
        // OTP would be a perfectly valid staff reset.
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.MEMBER), eq(1L), eq("hash")))
            .thenReturn(List.of(9L));
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L), eq("hash")))
            .thenReturn(List.of());

        assertEquals(Optional.of(9L), dao.findValidResetId(OtpService.MEMBER, 1L, "hash"));
        assertEquals(Optional.empty(), dao.findValidResetId(OtpService.STAFF, 1L, "hash"));
    }

    @Test
    void markUsedUpdatesTheRow() {
        dao.markUsed(9L);
        verify(jdbc).update(anyString(), eq(9L));
    }

    @Test
    void countSendsInLastHourCountsRecentResets() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(OtpService.STAFF), eq(1L))).thenReturn(4);
        assertEquals(4, dao.countSendsInLastHour(OtpService.STAFF, 1L));
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(OtpService.STAFF), eq(2L))).thenReturn(null);
        assertEquals(0, dao.countSendsInLastHour(OtpService.STAFF, 2L));
    }

    @Test
    void findActiveLockReturnsFutureLocksOnly() {
        Instant future = Instant.now().plusSeconds(600);
        Instant past = Instant.now().minusSeconds(60);

        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L)))
            .thenReturn(List.of(future));
        assertEquals(Optional.of(future), dao.findActiveLock(OtpService.STAFF, 1L));

        // An expired lock and a never-locked row must both come back empty.
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(2L)))
            .thenReturn(List.of(past));
        assertEquals(Optional.empty(), dao.findActiveLock(OtpService.STAFF, 2L));
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(3L)))
            .thenReturn(List.of());
        assertEquals(Optional.empty(), dao.findActiveLock(OtpService.STAFF, 3L));
    }

    @Test
    void findActiveLockToleratesNullLockColumn() {
        // A user with failed attempts but no lock (locked_until IS NULL) must not
        // blow up Stream.findFirst — this used to throw an NPE.
        // List.of() rejects null elements, so use Arrays.asList for the null row.
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L)))
            .thenReturn(java.util.Arrays.asList((Instant) null));
        assertEquals(Optional.empty(), dao.findActiveLock(OtpService.STAFF, 1L));
    }

    @Test
    void findActiveLockMapperMapsTimestampOrNull() throws Exception {
        ArgumentCaptor<RowMapper<Instant>> mapper = ArgumentCaptor.forClass(RowMapper.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(OtpService.STAFF), eq(1L)))
            .thenReturn(List.of());
        dao.findActiveLock(OtpService.STAFF, 1L);
        verify(jdbc).query(anyString(), mapper.capture(), eq(OtpService.STAFF), eq(1L));

        ResultSet rs = mock(ResultSet.class);
        Instant future = Instant.now().plusSeconds(600);
        when(rs.getTimestamp("locked_until")).thenReturn(Timestamp.from(future));
        assertEquals(future, mapper.getValue().mapRow(rs, 0));

        when(rs.getTimestamp("locked_until")).thenReturn(null);
        org.junit.jupiter.api.Assertions.assertNull(mapper.getValue().mapRow(rs, 0));
    }

    @Test
    void incrementFailuresReturnsNewCount() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq(OtpService.STAFF), eq(1L))).thenReturn(3);
        assertEquals(3, dao.incrementFailures(OtpService.STAFF, 1L));
    }

    @Test
    void applyLockAndClearFailuresRunTheirUpdates() {
        dao.applyLock(OtpService.STAFF, 1L, 15);
        verify(jdbc).update(anyString(), eq(15), eq(OtpService.STAFF), eq(1L));
        dao.clearFailures(OtpService.STAFF, 1L);
        verify(jdbc).update(anyString(), eq(OtpService.STAFF), eq(1L));
    }

    @Test
    void everyStatementKeepsTheScopeInThePredicate() {
        // A statement that forgets the scope silently mixes staff and member
        // rows, and nothing else in this suite would notice.
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        dao.clearSendHistory(OtpService.MEMBER, 7L);
        verify(jdbc).update(sql.capture(), eq(OtpService.MEMBER), eq(7L));
        assertTrue(sql.getValue().contains("scope = ?"), sql.getValue());
    }
}
