package com.gymos.auth.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.function.Executable;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.gymos.common.security.PasswordPolicy;
import com.gymos.auth.dao.UserDao;
import com.gymos.auth.dto.UserResponse;
import com.gymos.auth.entity.User;
import com.gymos.auth.service.UserService;
import com.gymos.common.api.BusinessException;

@ExtendWith(MockitoExtension.class)
class UserServiceImplTest {

    @Mock UserDao userDao;
    @Mock PasswordEncoder passwordEncoder;

    private UserService service;

    private final User bob = new User(5L, "bob", "oldhash", "Bob", "trainer",
        "bob@gym.local", "9990000002", Instant.parse("2026-01-01T00:00:00Z"), false);

    @BeforeEach
    void setUp() {
        service = new UserServiceImpl(userDao, passwordEncoder,
            new PasswordPolicy(userDao, passwordEncoder, 6, 5));
    }

    private static void assertBusiness(HttpStatus status, Executable ex) {
        BusinessException e = assertThrows(BusinessException.class, ex);
        assertEquals(status, e.getStatus(), "unexpected status for: " + e.getMessage());
    }

    // ---------- list ----------

    @Test
    void listAllMapsEntitiesToResponses() {
        when(userDao.findAll()).thenReturn(List.of(bob));
        List<UserResponse> all = service.listAll();
        assertEquals(1, all.size());
        assertEquals(5L, all.get(0).id());
        assertEquals("bob", all.get(0).username());
        assertEquals("Bob", all.get(0).name());
    }

    // ---------- create ----------

    @Test
    void createRequiresUsernameAndPassword() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> service.create(null, "pass", "A", "admin", null, null));
        assertBusiness(HttpStatus.BAD_REQUEST, () -> service.create("bob", null, "A", "admin", null, null));
        verify(userDao, never()).insert(any(), any(), any(), any(), any(), any());
    }

    @Test
    void createDefaultsRoleToTrainerAndHashesPassword() {
        when(passwordEncoder.encode("secret1")).thenReturn("encoded");
        when(userDao.insert(eq("bob"), eq("encoded"), eq("Bob"), eq("trainer"), eq("b@gym.local"), eq("9990000111")))
            .thenReturn(new User(7L, "bob", "encoded", "Bob", "trainer", "b@gym.local", "9990000111",
                Instant.parse("2026-01-01T00:00:00Z"), false));

        UserResponse res = service.create("bob", "secret1", "Bob", null, "b@gym.local", "9990000111");

        assertEquals(7L, res.id());
        assertEquals("trainer", res.role());
    }

    @Test
    void createDuplicateUsernameReturns409() {
        when(passwordEncoder.encode(anyString())).thenReturn("encoded");
        when(userDao.insert(any(), any(), any(), any(), any(), any()))
            .thenThrow(new DataIntegrityViolationException("duplicate key value violates unique constraint"));
        assertBusiness(HttpStatus.CONFLICT, () -> service.create("bob", "secret1", "Bob", "admin", null, null));
    }

    // ---------- update ----------

    @Test
    void updateRejectsShortPasswordBeforeAnyLookup() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> service.update(5L, "Bob", "trainer", null, null, "abc"));
        verify(userDao, never()).findById(any());
    }

    @Test
    void updateUnknownUserReturns404() {
        when(userDao.findById(99L)).thenReturn(Optional.empty());
        assertBusiness(HttpStatus.NOT_FOUND, () -> service.update(99L, "X", "admin", null, null, null));
    }

    @Test
    void updateNullFieldsKeepCurrentValues() {
        // COALESCE semantics: a null field keeps the existing value.
        when(userDao.findById(5L)).thenReturn(Optional.of(bob));

        UserResponse res = service.update(5L, null, null, null, null, null);

        verify(userDao).update(eq(5L), eq("Bob"), eq("trainer"),
            eq("bob@gym.local"), eq("9990000002"), eq("oldhash"));
        assertEquals("Bob", res.name());
        assertEquals("trainer", res.role());
    }

    @Test
    void updateAppliesProvidedFieldsAndHashesPassword() {
        User updated = new User(5L, "bob", "newhash", "Bobby", "admin", "b@gym.local", "9990000002",
            Instant.parse("2026-01-01T00:00:00Z"), false);
        when(userDao.findById(5L)).thenReturn(Optional.of(bob), Optional.of(updated));
        when(passwordEncoder.encode("newpass1")).thenReturn("newhash");

        UserResponse res = service.update(5L, "Bobby", "admin", "b@gym.local", null, "newpass1");

        // phone was not provided -> COALESCE keeps the existing value. The
        // profile update no longer touches the password column: changePassword
        // owns it, so it can archive the old hash and clear any forced reset.
        verify(userDao).update(eq(5L), eq("Bobby"), eq("admin"), eq("b@gym.local"),
            eq("9990000002"), eq("oldhash"));
        verify(userDao).changePassword(5L, "newhash");
        assertEquals("Bobby", res.name());
        assertEquals("admin", res.role());
    }

    // ---------- delete ----------

    @Test
    void deleteOwnAccountReturns400() {
        assertBusiness(HttpStatus.BAD_REQUEST, () -> service.delete(5L, 5L));
        verify(userDao, never()).delete(any());
    }

    @Test
    void deleteUnknownUserReturns404() {
        when(userDao.delete(99L)).thenReturn(0);
        assertBusiness(HttpStatus.NOT_FOUND, () -> service.delete(99L, 1L));
    }

    @Test
    void deleteSuccess() {
        when(userDao.delete(5L)).thenReturn(1);
        service.delete(5L, 1L);
        verify(userDao).delete(5L);
    }
}
