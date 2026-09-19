package com.gymos.auth.controller;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.auth.dto.CreateUserRequest;
import com.gymos.auth.dto.MessageResponse;
import com.gymos.auth.dto.UpdateUserRequest;
import com.gymos.auth.dto.UserResponse;
import com.gymos.auth.service.UserService;
import com.gymos.common.security.AuthUser;

/**
 * Admin-only user management — same paths as the Node /api/users routes.
 * The admin guard is enforced twice: the URL rule in SecurityConfig and this
 * method-level rule (belt and braces, like Express verifyToken + requireRole).
 */
@RestController
@RequestMapping("/api")
@PreAuthorize("hasRole('ADMIN')")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/users")
    public List<UserResponse> listUsers() {
        return userService.listAll();
    }

    @PostMapping("/users")
    public ResponseEntity<UserResponse> createUser(@RequestBody CreateUserRequest req) {
        return ResponseEntity.status(201).body(
            userService.create(req.username(), req.password(), req.name(), req.role(), req.email(), req.phone()));
    }

    @PutMapping("/users/{id}")
    public UserResponse updateUser(@PathVariable Long id, @RequestBody UpdateUserRequest req) {
        return userService.update(id, req.name(), req.role(), req.email(), req.phone(), req.password());
    }

    @DeleteMapping("/users/{id}")
    public MessageResponse deleteUser(@PathVariable Long id, @AuthenticationPrincipal AuthUser me) {
        userService.delete(id, me.id());
        return new MessageResponse("User deleted");
    }
}
