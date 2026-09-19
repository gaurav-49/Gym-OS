package com.gymos.device.service.impl;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.attendance.service.AttendanceService;
import com.gymos.attendance.service.GateException;
import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.device.dao.DeviceDao;
import com.gymos.device.service.DeviceService;
import com.gymos.member.dao.ClientDao;

/**
 * Device service — fingerprint/card punch intake (port of deviceController.js):
 * resolves the member by card UID or member_code, runs the same gate checks as
 * the manual form, and confirms fingerprint enrollment on first punch.
 */
@Service
public class DeviceServiceImpl implements DeviceService {

    private static final Logger log = LoggerFactory.getLogger("deviceController");

    private final AttendanceService attendanceService;
    private final ClientDao clientDao;
    private final DeviceDao deviceDao;

    public DeviceServiceImpl(AttendanceService attendanceService, ClientDao clientDao, DeviceDao deviceDao) {
        this.attendanceService = attendanceService;
        this.clientDao = clientDao;
        this.deviceDao = deviceDao;
    }

    private static final int MAX_NAME = 100;
    private static final int MIN_PORT = 1;
    private static final int MAX_PORT = 65535;
    private static final int DEFAULT_PORT = 80;

    /** Dotted-quad only. A terminal is on the gym's LAN, not behind DNS. */
    private static final java.util.regex.Pattern IPV4 = java.util.regex.Pattern.compile(
        "^((25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$");

    @Override
    public Map<String, Object> createDevice(Map<String, Object> body) {
        String name = trimmed(body, "name");
        String ip = trimmed(body, "ip_address");
        if (name == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Give the device a name — it is how staff tell two terminals apart.");
        }
        if (name.length() > MAX_NAME) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "The device name cannot be longer than " + MAX_NAME + " characters.");
        }
        if (ip == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "The device's IP address is required — without it nothing can reach the terminal.");
        }
        requireIp(ip);
        int port = requirePort(body);
        boolean active = !body.containsKey("is_active") || Boolean.TRUE.equals(Body.bool(body, "is_active"));
        return deviceDao.insert(name, ip, port, active);
    }

    @Override
    public Map<String, Object> updateDevice(Long id, Map<String, Object> body) {
        deviceDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Device not found"));
        String name = trimmed(body, "name");
        if (body.containsKey("name") && name == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "The device name cannot be blank.");
        }
        String ip = trimmed(body, "ip_address");
        if (body.containsKey("ip_address")) {
            if (ip == null) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "The device's IP address cannot be blank.");
            }
            requireIp(ip);
        }
        Integer port = null;
        if (body.containsKey("port") && body.get("port") != null) {
            port = requirePort(body);
        }
        return deviceDao.update(id, name, ip, port,
            body.containsKey("is_active") ? Body.bool(body, "is_active") : null);
    }

    @Override
    public Map<String, Object> deleteDevice(Long id) {
        if (deviceDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Device not found");
        }
        return Map.of("id", id);
    }

    private static void requireIp(String ip) {
        if (!IPV4.matcher(ip).matches()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "\"" + ip + "\" is not a valid IP address. Use the terminal's LAN address, like 192.168.1.50.");
        }
    }

    private static int requirePort(Map<String, Object> body) {
        if (body.get("port") == null || String.valueOf(body.get("port")).isBlank()) {
            return DEFAULT_PORT;
        }
        int port;
        try {
            port = Integer.parseInt(String.valueOf(body.get("port")).trim());
        } catch (NumberFormatException e) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "The port must be a whole number.");
        }
        if (port < MIN_PORT || port > MAX_PORT) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "The port must be between " + MIN_PORT + " and " + MAX_PORT + ".");
        }
        return port;
    }

    private static String trimmed(Map<String, Object> body, String key) {
        String v = Body.str(body, key);
        return v == null || v.trim().isEmpty() ? null : v.trim();
    }

    @Override
    public Map<String, Object> punch(String memberId, String cardUid, String deviceId) {
        String via;
        Map<String, Object> member;
        if (cardUid != null && !cardUid.trim().isEmpty()) {
            String uid = normalizeCardUid(cardUid);
            member = clientDao.findGateMemberByCardUid(uid)
                .orElseThrow(() -> new GateException("MEMBER_NOT_FOUND",
                    "Unknown card. Register the card against a member before punching."));
            via = "card";
        } else if (memberId == null || memberId.isEmpty()) {
            throw new GateException("MISSING_CREDENTIAL", "member_id or card_uid is required");
        } else {
            member = clientDao.findGateMemberByCode(memberId)
                .orElseThrow(() -> new GateException("MEMBER_NOT_FOUND",
                    "Member not found. Register the member before punching."));
            via = "fingerprint";
        }

        String date = LocalDateTime.now().toString().substring(0, 10);
        String time = LocalTime.now().withNano(0).toString();
        Map<String, Object> record = attendanceService.mark(
            String.valueOf(member.get("member_code")), null, date, time, "Present",
            "card".equals(via) ? "card" : "device", member);

        if ("fingerprint".equals(via) && "pending".equals(String.valueOf(member.get("fingerprint_status")))) {
            clientDao.updateFingerprintStatus(Body.toLong(member.get("id")), "enrolled");
            log.info("Fingerprint enrollment confirmed by the machine, member={}", member.get("member_code"));
        }

        String deviceName = "fingerprint device";
        if (deviceId != null) {
            deviceName = deviceDao.findName(Body.toLong(deviceId)).map(d -> String.valueOf(d.get("name")))
                .orElse(deviceName);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", "Attendance marked for " + record.get("member_name") + " via "
            + ("card".equals(via) ? "card" : deviceName) + ".");
        res.put("record", record);
        res.put("via", via);
        return res;
    }

    private static String normalizeCardUid(String raw) {
        return raw.trim().replaceAll("[\\s-]+", "").toUpperCase();
    }
}
