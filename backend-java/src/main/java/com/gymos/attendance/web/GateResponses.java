package com.gymos.attendance.web;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import com.gymos.attendance.service.GateException;

/**
 * One mapping from a gate refusal to an HTTP reply, shared by every door.
 *
 * <p>The manual attendance form, the QR scanner and the fingerprint terminal
 * each had their own copy of this switch, and they had drifted: the manual one
 * handled only DUPLICATE and INVALID_DATE, so the day the dues check started
 * applying to it, a locked-out member got a 500 instead of "clear the dues".
 * The same drift is what let that path skip the gate in the first place.
 */
public final class GateResponses {

    private GateResponses() {
    }

    public static ResponseEntity<Object> of(GateException e) {
        return switch (e.getCode()) {
            case "DUPLICATE" ->
                ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", e.getMessage()));
            case "MEMBER_NOT_FOUND" ->
                ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
            case "MEMBER_INACTIVE", "INVALID_DATE", "MISSING_CREDENTIAL" ->
                ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
            // The gym does not run instalments: an unpaid balance locks the
            // door exactly like an expired or frozen membership does.
            case "EXPIRED", "MEMBER_FROZEN", "DUES_PENDING" ->
                ResponseEntity.status(HttpStatus.FORBIDDEN)
                    .body(Map.of("error", e.getMessage(), "gate", "locked"));
            default -> throw e;
        };
    }
}
