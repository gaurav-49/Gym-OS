package com.gymos.branding.controller;

import java.util.Map;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.branding.service.BrandingService;

/**
 * GET  /api/branding — public. The login screen and the member portal need the
 *                      gym's name before anyone has authenticated.
 * PUT  /api/branding — admin only (enforced in SecurityConfig).
 */
@RestController
@RequestMapping("/api/branding")
public class BrandingController {

    private final BrandingService brandingService;

    public BrandingController(BrandingService brandingService) {
        this.brandingService = brandingService;
    }

    @GetMapping
    public Map<String, Object> get() {
        return brandingService.get();
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> update(@RequestBody Map<String, Object> body) {
        return brandingService.update(body);
    }
}
