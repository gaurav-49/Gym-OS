package com.gymos.classes.dao;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Class scheduling & bookings data access — mirrors the SQL in classesController.js.
 * All SQL lives in {@link com.gymos.classes.dao.impl.ClassDaoImpl}.
 */
public interface ClassDao {

    List<Map<String, Object>> findTrainers();

    List<Map<String, Object>> findClasses(boolean includePast);

    Optional<Map<String, Object>> findById(Long id);

    Optional<String> findStatusById(Long id);

    /** { booked, waitlisted } counts for a class. */
    Map<String, Object> counts(Long classId);

    Optional<Map<String, Object>> myStatus(Long classId, Long memberId);

    Map<String, Object> insertClass(String name, String description, Long trainerId, String classDate,
                                    String startTime, String endTime, Integer capacity);

    void insertClassBatch(String name, String description, Long trainerId, String classDate,
                          String startTime, String endTime, Integer capacity);

    Map<String, Object> updateClass(Long id, String name, String description, Long trainerId, String classDate,
                                    String startTime, String endTime, Integer capacity, String status);

    int cancelClass(Long id);

    List<Map<String, Object>> findBookings(Long classId);

    Optional<Map<String, Object>> findActiveBooking(Long classId, Long memberId);

    void upsertBooking(Long classId, Long memberId, String status);

    int cancelBooking(Long classId, Long memberId);

    Optional<Map<String, Object>> firstWaitlisted(Long classId);

    Optional<Long> promoteWaitlisted(Long bookingId);

    /**
     * Where this member sits in the queue for a class, 1-based.
     *
     * <p>1.0 waitlisted people silently: a member could see they were not booked
     * but never how close they were. Ordered by created_at then id, exactly like
     * {@link #firstWaitlisted(Long)}, so the number shown always matches who
     * actually gets promoted next.
     */
    Optional<Integer> waitlistPosition(Long classId, Long memberId);

    /** Name, phone and email of a member, for notifying a promotion. */
    Optional<Map<String, Object>> findMemberContact(Long memberId);

    Optional<String> findMemberName(Long memberId);

    Optional<Map<String, Object>> findMemberBookable(Long memberId);

    List<Map<String, Object>> memberClasses(Long memberId);

    List<Map<String, Object>> myBookings(Long memberId);
}
