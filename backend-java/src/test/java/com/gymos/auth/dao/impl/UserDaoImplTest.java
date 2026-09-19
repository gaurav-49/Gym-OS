package com.gymos.auth.dao.impl;

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

import com.gymos.auth.dao.UserDao;
import com.gymos.auth.entity.User;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class UserDaoImplTest {

    @Mock JdbcTemplate jdbc;

    private UserDao dao;

    @BeforeEach
    void setUp() {
        dao = new UserDaoImpl(jdbc);
    }

    @Test
    void findByUsernameRunsSelectAndMapsTheRow() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong("id")).thenReturn(42L);
        when(rs.getString("username")).thenReturn("admin");
        when(rs.getString("password_hash")).thenReturn("hash");
        when(rs.getString("name")).thenReturn("Administrator");
        when(rs.getString("role")).thenReturn("admin");
        when(rs.getString("email")).thenReturn("admin@gym.local");
        when(rs.getString("phone")).thenReturn("9990000001");
        when(rs.getTimestamp("created_at")).thenReturn(Timestamp.from(Instant.parse("2026-01-01T00:00:00Z")));

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<RowMapper<User>> mapper = ArgumentCaptor.forClass(RowMapper.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq("admin"))).thenReturn(List.of());

        // Passed in mixed case on purpose — the DAO normalises before binding.
        dao.findByUsername("Admin");

        verify(jdbc).query(sql.capture(), mapper.capture(), eq("admin"));
        // Compared without case: a phone keyboard capitalising the first
        // letter must not turn one account into two.
        assertTrue(sql.getValue().contains("FROM users WHERE LOWER(username) = ?"), sql.getValue());

        // Map the captured row mapper against the stubbed result set.
        User u = mapper.getValue().mapRow(rs, 0);
        assertEquals(42L, u.id());
        assertEquals("admin", u.username());
        assertEquals("hash", u.passwordHash());
        assertEquals("Administrator", u.name());
        assertEquals("admin", u.role());
        assertEquals("admin@gym.local", u.email());
        assertEquals("9990000001", u.phone());
        assertEquals(Instant.parse("2026-01-01T00:00:00Z"), u.createdAt());
    }

    @Test
    void findByUsernameReturnsEmptyWhenNoRowMatches() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq("nobody"))).thenReturn(List.of());
        assertEquals(Optional.empty(), dao.findByUsername("nobody"));
    }

    @Test
    void findByIdRunsSelect() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(7L))).thenReturn(List.of());
        assertEquals(Optional.empty(), dao.findById(7L));
    }

    @Test
    void findAllReturnsAllRows() {
        when(jdbc.query(anyString(), any(RowMapper.class))).thenReturn(List.of());
        assertTrue(dao.findAll().isEmpty());
    }

    @Test
    void insertPassesFieldsInOrderAndReturnsTheRow() {
        User row = new User(1L, "bob", "hash", "Bob", "trainer", "b@gym.local", "111",
            Instant.parse("2026-01-01T00:00:00Z"), false);
        when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq("bob"), eq("hash"), eq("Bob"),
            eq("trainer"), eq("b@gym.local"), eq("111"))).thenReturn(row);

        User inserted = dao.insert("bob", "hash", "Bob", "trainer", "b@gym.local", "111");

        assertEquals(1L, inserted.id());
        assertEquals("bob", inserted.username());
    }

    @Test
    void updatePassesFieldsInOrder() {
        dao.update(7L, "Bobby", "admin", "b@gym.local", "222", "newhash");
        verify(jdbc).update(anyString(), eq("Bobby"), eq("admin"), eq("b@gym.local"), eq("222"),
            eq("newhash"), eq(7L));
    }

    @Test
    void deleteReturnsAffectedRowCount() {
        when(jdbc.update(anyString(), eq(7L))).thenReturn(1);
        assertEquals(1, dao.delete(7L));
        when(jdbc.update(anyString(), eq(99L))).thenReturn(0);
        assertEquals(0, dao.delete(99L));
    }
}
