package com.gymos.common.api;

/** Standard error body: { "error": "message" } — identical to the Node backend. */
public record ApiError(String error) {
}
