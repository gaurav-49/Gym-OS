package com.gymos.attendance.controller;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.gymos.attendance.service.AttendanceService;
import com.gymos.attendance.service.GateException;
import com.gymos.attendance.web.GateResponses;

@RestController
@RequestMapping("/api/attendance")
public class AttendanceController {

    private final AttendanceService attendanceService;

    public AttendanceController(AttendanceService attendanceService) {
        this.attendanceService = attendanceService;
    }

    @GetMapping
    public List<Map<String, Object>> getAll() {
        return attendanceService.findAll();
    }

    @GetMapping("/report")
    public List<Map<String, Object>> report(@RequestParam(required = false) String from,
                                            @RequestParam(required = false) String to,
                                            @RequestParam(required = false) String member_id,
                                            @RequestParam(required = false) String status,
                                            @RequestParam(required = false) String source) {
        return attendanceService.report(from, to, member_id, status, source);
    }

    @PostMapping("/mark")
    public ResponseEntity<?> mark(@RequestBody Map<String, Object> body) {
        try {
            Map<String, Object> record = attendanceService.mark(
                str(body, "member_id"), str(body, "member_name"), str(body, "date"),
                str(body, "time"), str(body, "status"), "manual", null);
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("message", "Attendance marked for " + record.get("member_name") + ".");
            res.put("record", record);
            return ResponseEntity.status(HttpStatus.CREATED).body(res);
        } catch (GateException e) {
            return GateResponses.of(e);
        }
    }

    @PostMapping("/qr-punch")
    public ResponseEntity<?> qrPunch(@RequestBody Map<String, Object> body) {
        Object raw = body.get("member_id");
        if (raw == null || String.valueOf(raw).isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "member_id is required"));
        }
        String now = java.time.LocalDateTime.now().toString().replace("T", " ");
        String date = now.substring(0, 10);
        String time = java.time.LocalTime.now().withNano(0).toString();
        try {
            Map<String, Object> record = attendanceService.mark(
                String.valueOf(raw), null, date, time, "Present", "qr", null);
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("message", "QR check-in for " + record.get("member_name") + ".");
            res.put("record", record);
            return ResponseEntity.status(HttpStatus.CREATED).body(res);
        } catch (GateException e) {
            return GateResponses.of(e);
        }
    }

    private static String str(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
