package com.gymos.device.controller;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.attendance.service.GateException;
import com.gymos.attendance.web.GateResponses;
import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.device.dao.DeviceDao;
import com.gymos.device.service.DeviceService;

/**
 * Device endpoints — the punch route is public (the terminal can't log in);
 * device settings are authenticated with admin writes.
 */
@RestController
@RequestMapping("/api")
public class DeviceController {

    private final DeviceService deviceService;
    private final DeviceDao deviceDao;

    public DeviceController(DeviceService deviceService, DeviceDao deviceDao) {
        this.deviceService = deviceService;
        this.deviceDao = deviceDao;
    }

    @PostMapping("/device/punch")
    public ResponseEntity<?> punch(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> res = deviceService.punch(
                Body.str(body, "member_id"), Body.str(body, "card_uid"), Body.str(body, "device_id"));
            return ResponseEntity.status(HttpStatus.CREATED).body(res);
        } catch (GateException e) {
            return GateResponses.of(e);
        }
    }

    @GetMapping("/devices")
    public List<Map<String, Object>> getDevices() {
        return deviceDao.findAll();
    }

    // Validation lives in the service like every other module — this used to
    // build the record inline and default a missing name to "eSSL X990".
    @PostMapping("/devices")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> createDevice(@RequestBody Map<String, Object> body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(deviceService.createDevice(body));
    }

    @PutMapping("/devices/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> updateDevice(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return deviceService.updateDevice(id, body);
    }

    @DeleteMapping("/devices/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> deleteDevice(@PathVariable Long id) {
        return deviceService.deleteDevice(id);
    }
}
