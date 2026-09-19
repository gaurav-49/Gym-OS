package com.gymos.attendance.service;

/**
 * Gate/punch failure carrying the Node error `.code` vocabulary:
 * MEMBER_NOT_FOUND, MEMBER_INACTIVE, MEMBER_FROZEN, DUES_PENDING, EXPIRED,
 * DUPLICATE, INVALID_DATE, MISSING_CREDENTIAL. Controllers map the code to the
 * exact status/body the Node backend returns.
 */
public class GateException extends RuntimeException {

    private final String code;

    public GateException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
