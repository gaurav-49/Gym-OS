package com.gymos.lookup.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.lookup.service.LookupService;

/**
 * Exceptions master-table endpoints — mirrors backend/src/routes/exceptionsRoutes.js.
 * The frontend renders validation alerts as "[E-code] MESSAGE." from this data.
 */
@RestController
@RequestMapping("/api/exceptions")
public class ExceptionsController {

    private final LookupService lookupService;

    public ExceptionsController(LookupService lookupService) {
        this.lookupService = lookupService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String module) {
        return lookupService.listExceptions(module);
    }
}
