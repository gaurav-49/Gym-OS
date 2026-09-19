package com.gymos.lookup.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.lookup.service.LookupService;

/**
 * Field-rules endpoints — legacy alias of /api/exceptions (the Node backend
 * routes both to the same handler, so the same data is served here).
 */
@RestController
@RequestMapping("/api/field-rules")
public class FieldRulesController {

    private final LookupService lookupService;

    public FieldRulesController(LookupService lookupService) {
        this.lookupService = lookupService;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String module) {
        return lookupService.listExceptions(module);
    }
}
