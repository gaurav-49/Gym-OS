package com.gymos.device.service;

import java.util.Map;

/**
 * Device punch intake — the fingerprint terminal posts to /api/device/punch
 * with a member_code (or card_uid for card readers); both run the same gate
 * validation as the manual attendance form.
 */
public interface DeviceService {

    /**
     * Register a biometric/RFID terminal.
     *
     * <p>The name and IP were previously optional, and an empty form quietly
     * created a device called "eSSL X990" pointing at nothing. Two of those on
     * one page look identical, and neither can be reached.
     */
    java.util.Map<String, Object> createDevice(java.util.Map<String, Object> body);

    java.util.Map<String, Object> updateDevice(Long id, java.util.Map<String, Object> body);

    java.util.Map<String, Object> deleteDevice(Long id);

    Map<String, Object> punch(String memberId, String cardUid, String deviceId);
}
