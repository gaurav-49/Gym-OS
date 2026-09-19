package com.gymos.notification.controller;

import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.common.util.Body;
import com.gymos.notification.dao.NotificationDao;
import com.gymos.notification.service.ReminderService;

/**
 * Notification endpoints — mirrors backend/src/routes/notificationRoutes.js.
 * Reads are open to any authenticated staff; sends/settings writes are admin-only.
 */
@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final ReminderService reminderService;
    private final NotificationDao notificationDao;

    public NotificationController(ReminderService reminderService, NotificationDao notificationDao) {
        this.reminderService = reminderService;
        this.notificationDao = notificationDao;
    }

    @GetMapping("/settings")
    public Map<String, Object> getSettings() {
        return reminderService.getSettings();
    }

    @PutMapping("/settings")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateSettings(@RequestBody Map<String, Object> body) {
        return reminderService.saveSettings(body);
    }

    @GetMapping("/expiring")
    public Map<String, Object> expiring(@RequestParam(required = false) String days) {
        int d = days == null || days.isBlank()
            ? Body.toInt(reminderService.getSettings().get("expiry_reminder_days"))
            : Body.toInt(days);
        return reminderService.getExpiring(d);
    }

    @PostMapping("/expiry-reminder/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> sendManual(@PathVariable Long id) {
        return reminderService.sendManualReminder(id);
    }

    @PostMapping("/expiry-reminders")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> sendAll() {
        return reminderService.sendAllReminders();
    }

    @GetMapping("/log")
    public java.util.List<Map<String, Object>> log() {
        return notificationDao.notificationLog();
    }
}
