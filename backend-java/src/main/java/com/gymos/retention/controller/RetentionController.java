package com.gymos.retention.controller;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.retention.service.RetentionService;

/**
 * Churn risk. Open to any signed-in staff — the whole point is that whoever is
 * on the desk can see who needs a call today.
 */
@RestController
@RequestMapping("/api/retention")
public class RetentionController {

    private final RetentionService retentionService;

    public RetentionController(RetentionService retentionService) {
        this.retentionService = retentionService;
    }

    /** Band counts now, plus the trend over the last N days. */
    @GetMapping("/summary")
    public Map<String, Object> summary(@RequestParam(required = false) String days) {
        return retentionService.summary(days);
    }

    /** @param band at-risk / watch / healthy; omit for every scored member */
    @GetMapping("/at-risk")
    public List<Map<String, Object>> atRisk(@RequestParam(required = false) String band,
                                            @RequestParam(required = false) String limit) {
        return retentionService.atRisk(band, limit);
    }

    /**
     * Rescore everyone now. The scheduler does this nightly; this is the
     * "refresh" button for a desk that wants today's numbers immediately.
     *
     * @param tasks pass {@code false} to score without raising follow-ups
     */
    @PostMapping("/recompute")
    public Map<String, Object> recompute(@RequestParam(required = false) String tasks) {
        return retentionService.recompute(!"false".equals(tasks));
    }
}
