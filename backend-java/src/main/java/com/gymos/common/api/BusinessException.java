package com.gymos.common.api;

import org.springframework.http.HttpStatus;

/**
 * Common business exception. Services throw this to produce the same
 * { error } JSON with the same status code as the Node backend
 * (400 / 401 / 403 / 404 / 409 / 429…). Handled centrally by
 * {@link com.gymos.common.web.GlobalExceptionHandler}.
 */
public class BusinessException extends RuntimeException {

    private final HttpStatus status;

    public BusinessException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    /** Variant that keeps the root cause so error logs show the full chain. */
    public BusinessException(HttpStatus status, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
    }

    public HttpStatus getStatus() {
        return status;
    }
}
