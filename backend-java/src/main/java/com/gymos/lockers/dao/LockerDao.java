package com.gymos.lockers.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** The gym's physical lockers: who holds each one, until when, at what rent. */
public interface LockerDao {

    List<Map<String, Object>> findLockers(String status, String search);

    Optional<Map<String, Object>> findById(Long id);

    /** The same row plus the holder's name, for release messages. */
    Optional<Map<String, Object>> findByIdWithMember(Long id);

    Optional<Map<String, Object>> findByNumber(String lockerNumber);

    /** The locker this member already holds, if any — one locker per member. */
    Optional<Map<String, Object>> findHeldBy(Long memberId);

    Map<String, Object> insert(String lockerNumber, String location, String size,
                               BigDecimal monthlyRent, String notes);

    Map<String, Object> update(Long id, String location, String size, BigDecimal monthlyRent,
                               String notes, String status);

    Map<String, Object> assign(Long id, Long memberId, String from, String until);

    Map<String, Object> release(Long id);

    void delete(Long id);
}
