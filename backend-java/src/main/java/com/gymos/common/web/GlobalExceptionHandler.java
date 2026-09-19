package com.gymos.common.web;

import java.sql.SQLException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.gymos.common.api.ApiError;
import com.gymos.common.api.BusinessException;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Central error handler — mirrors the Express error middleware: every failure
 * becomes { "error": "message" } with the same status code. Log lines carry the
 * request id (MDC) so they correlate with the frontend logs end to end.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger("app");

    @ExceptionHandler(BusinessException.class)
    ResponseEntity<ApiError> handleBusiness(BusinessException e, HttpServletRequest request) {
        String where = where(request);
        if (e.getStatus().is4xxClientError()) {
            log.warn("errorHandler :: {} → {}", where, e.getMessage());
        } else {
            log.error("errorHandler :: {} → {}", where, e.getMessage(), e);
        }
        return ResponseEntity.status(e.getStatus()).body(new ApiError(e.getMessage()));
    }

    /** "null value in column \"reward_value\" of relation ..." → reward_value */
    private static final Pattern NULL_COLUMN = Pattern.compile("column \"([^\"]+)\"");

    /**
     * Database constraint violations.
     *
     * <p>Every one of these used to be answered "Conflict: this value is
     * already taken", which is only true of a unique violation. A missing
     * required field came back as a duplicate — a member inviting a friend was
     * told the name was taken when the real fault was a NOT NULL column the
     * server never filled in, so nobody looking at the screen could tell what
     * to fix. The SQLSTATE says which kind it was, so say which kind it was.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiError> handleConflict(DataIntegrityViolationException e, HttpServletRequest request) {
        Throwable cause = e.getMostSpecificCause();
        String detail = cause.getMessage() == null ? "" : cause.getMessage();
        String state = cause instanceof SQLException sql ? sql.getSQLState() : null;
        // The full cause always goes to the log — the reply is deliberately
        // vaguer than this, and without it a 400 here is undiagnosable.
        log.warn("errorHandler :: {} → constraint {}: {}", where(request), state, detail);

        return switch (state == null ? "" : state) {
            // unique_violation — the only case that really is "already taken".
            case "23505" -> ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiError("Conflict: this value is already taken."));
            // not_null_violation — a required field never made it to the insert.
            case "23502" -> ResponseEntity.badRequest()
                .body(new ApiError(fieldMessage(detail, "is required and was not provided")));
            // foreign_key_violation — points at a row that does not exist, or
            // is still referenced by something else.
            case "23503" -> ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ApiError("That record is linked to something else, "
                    + "or refers to something that no longer exists."));
            // check_violation — a value outside what the column allows.
            case "23514" -> ResponseEntity.badRequest()
                .body(new ApiError("One of the values is not allowed for that field."));
            default -> ResponseEntity.badRequest()
                .body(new ApiError("That could not be saved — one of the values was rejected "
                    + "by the database."));
        };
    }

    /** Names the offending column in the reply when the driver reported one. */
    private static String fieldMessage(String detail, String suffix) {
        Matcher m = NULL_COLUMN.matcher(detail);
        if (!m.find()) {
            return "A required field " + suffix + ".";
        }
        return "\"" + m.group(1).replace('_', ' ') + "\" " + suffix + ".";
    }

    // @PreAuthorize violations (method security) surface here as AccessDenied;
    // answer 403 JSON like the Node requireRole middleware.
    @ExceptionHandler(AccessDeniedException.class)
    ResponseEntity<ApiError> handleAccessDenied(AccessDeniedException e, HttpServletRequest request) {
        log.warn("errorHandler :: {} → 403 insufficient permissions", where(request));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiError("Insufficient permissions"));
    }

    // Unknown route -> 404 JSON (Spring raises NoResourceFoundException; without
    // this it would fall through to the generic 500 handler).
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ApiError> handleNotFound(NoResourceFoundException e, HttpServletRequest request) {
        log.warn("errorHandler :: {} → 404 not found", where(request));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ApiError("Not found"));
    }

    // Empty / malformed JSON body -> 400 (Node tolerates it and validates per-field).
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiError> handleUnreadable(HttpMessageNotReadableException e, HttpServletRequest request) {
        log.warn("errorHandler :: {} → invalid request body", where(request));
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ApiError("Invalid request body"));
    }

    /**
     * Spring's own web exceptions already carry the right status — 405 for a
     * method that route does not support, 415 for the wrong content type, 400
     * for a missing or unconvertible parameter. Without this they fell through
     * to the catch-all below and were reported as 500 Internal Server Error,
     * which tells a caller their perfectly-formed mistake is the server's fault.
     */
    @ExceptionHandler({
        HttpRequestMethodNotSupportedException.class,
        HttpMediaTypeNotSupportedException.class,
        HttpMediaTypeNotAcceptableException.class,
        MissingServletRequestParameterException.class,
        MethodArgumentTypeMismatchException.class,
    })
    ResponseEntity<ApiError> handleSpringWebError(Exception e, HttpServletRequest request) {
        // These all implement ErrorResponse and already carry the right status.
        HttpStatus status = e instanceof ErrorResponse er
            ? HttpStatus.valueOf(er.getStatusCode().value())
            : HttpStatus.BAD_REQUEST;
        String message = switch (status) {
            case METHOD_NOT_ALLOWED -> "That method is not supported on this route.";
            case UNSUPPORTED_MEDIA_TYPE -> "Send this request as application/json.";
            case NOT_ACCEPTABLE -> "This route can only answer with JSON.";
            default -> e.getMessage() == null ? "Bad request" : e.getMessage();
        };
        log.warn("errorHandler :: {} → {} {}", where(request), status.value(), message);
        return ResponseEntity.status(status).body(new ApiError(message));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> handleUnknown(Exception e, HttpServletRequest request) {
        log.error("errorHandler :: {} → {}", where(request), e.getMessage(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ApiError("Internal server error"));
    }

    private static String where(HttpServletRequest request) {
        return String.format("rid=%s %s %s",
            RequestIdFilter.idOf(request), request.getMethod(), request.getRequestURI());
    }
}
