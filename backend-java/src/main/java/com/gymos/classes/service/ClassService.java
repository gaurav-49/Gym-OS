package com.gymos.classes.service;

import java.util.List;
import java.util.Map;

/**
 * Class scheduling & bookings service — mirrors classesController.js, shared by
 * the staff routes and the member self-service routes (common booking core).
 */
public interface ClassService {

    List<Map<String, Object>> getTrainers();

    List<Map<String, Object>> getClasses(String includePast, Long memberId);

    Map<String, Object> getClassDetail(Long id);

    Map<String, Object> createClass(Map<String, Object> body);

    Map<String, Object> createSeries(Map<String, Object> body);

    Map<String, Object> updateClass(Long id, Map<String, Object> body);

    Map<String, Object> deleteClass(Long id);

    /** Staff booking — {@code { status, className }}. */
    Map<String, Object> book(Long classId, Long memberId);

    /** Staff cancel — {@code { promoted }} (earliest waitlisted member promoted). */
    Map<String, Object> cancelBooking(Long classId, Long memberId);

    /** Member self-service handshake (Member ID + phone → member JWT). */
    /**
     * Member sign-in for the standalone booking page — Member ID + password,
     * identical to the portal. It used to accept the registered phone number,
     * which made it a way around the portal's password.
     */
    Map<String, Object> verifyMember(String memberCode, String password);

    List<Map<String, Object>> memberClasses(Long memberId);

    List<Map<String, Object>> myBookings(Long memberId);

    Map<String, Object> memberBook(Long classId, Long memberId);

    Map<String, Object> memberCancel(Long classId, Long memberId);
}
