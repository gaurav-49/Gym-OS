package com.gymos.auth.service;

import java.util.List;

import com.gymos.auth.dto.UserResponse;

/**
 * Admin user management — port of the Node /api/users endpoints. Implemented by
 * UserServiceImpl.
 */
public interface UserService {

    List<UserResponse> listAll();

    /** The signed-in staff member's own appearance choice; null = follow the device. */
    String themePreference(Long id);

    String setThemePreference(Long id, String theme);

    UserResponse create(String username, String password, String name, String role,
                        String email, String phone);

    UserResponse update(Long id, String name, String role, String email, String phone, String password);

    void delete(Long id, Long currentUserId);
}
