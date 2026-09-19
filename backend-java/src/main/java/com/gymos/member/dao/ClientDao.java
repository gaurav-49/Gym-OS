package com.gymos.member.dao;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Client (member) data access — rows are returned as column maps (snake_case
 * keys), matching the Node pg row shape exactly. All SQL lives in
 * {@link com.gymos.member.dao.impl.ClientDaoImpl}.
 */
public interface ClientDao {

    List<Map<String, Object>> findAllWithTrainer();

    Optional<Map<String, Object>> findByIdWithTrainer(Long id);

    Optional<Map<String, Object>> findById(Long id);

    /** @return the row the member_code belongs to, if any (duplicate check). */
    Optional<Map<String, Object>> findByMemberCode(String code);

    /**
     * The next Member ID to hand out: the lowest number given back by a
     * deletion, or the next one in the sequence when none have been.
     *
     * <p>A suggestion, not a reservation — the desk can type its own, and the
     * unique index is what actually guarantees uniqueness.
     */
    Long nextMemberCode();

    /** Records that a code is now held by this member. */
    void claimMemberCode(String code, Long memberId);

    /** Gives a code back to the queue when the member's record is deleted. */
    void releaseMemberCode(String code);

    /** Member self-service lookup (id, member_code, name, phone, status). */
    Optional<Map<String, Object>> findByMemberCodeFull(String code);

    Optional<Map<String, Object>> findByMemberCodeExcept(String code, Long exceptId);

    Optional<Map<String, Object>> findByCardUid(String uid);

    Optional<Map<String, Object>> findByCardUidExcept(String uid, Long exceptId);

    /**
     * Assign a member's shareable referral code, skipping it if some other
     * member already holds that string.
     *
     * @return the code actually stored, or empty when it was already taken
     */
    Optional<String> assignReferralCode(Long memberId, String referralCode);

    Map<String, Object> insert(String code, String name, String phone, String email, String address,
                               String gender, String dob, String join, String type, String start,
                               String expiry, BigDecimal fee, BigDecimal paid, BigDecimal due,
                               String paymentMode, String status, Long trainerId, String cardUid,
                               String fingerprintStatus);

    Map<String, Object> update(Long id, String name, String phone, String email, String address,
                               String gender, String dob, String joinDate, String membershipType,
                               String membershipStart, String membershipExpiry, BigDecimal fee,
                               BigDecimal paid, String paymentMode, String status, Long trainerId,
                               String memberCode, Boolean autoRenew, String recurringMethod,
                               BigDecimal due, Boolean cardUidSet, String cardUidValue,
                               Boolean fpSet, String fpValue);

    int updateMemberCode(Long id, String newCode);

    int deactivate(Long id);

    /**
     * Removes the member and everything hanging off them, permanently.
     *
     * <p>Nothing in this schema cascades from {@code clients} — payments,
     * measurements and bookings all hold a bare member_id — so the children go
     * first, by hand. Deleting the row without them left orphan money rows
     * that no screen could reach and no report could explain.
     *
     * @return how many rows went, by table, for the audit line
     */
    Map<String, Integer> purge(Long id, String memberCode);

    Map<String, Object> freeze(Long id, String freezeUntil, String reason, String newExpiry);

    Map<String, Object> resume(Long id);

    Map<String, Object> upgrade(Long id, String newType, String newExpiry);

    Map<String, Object> cancelNow(Long id);

    Map<String, Object> cancelAtExpiry(Long id);

    Map<String, Object> renew(Long id, String newExpiry, String type, BigDecimal fee, BigDecimal paid,
                              String mode, BigDecimal renewDue);

    int cascadeAttendanceCode(String oldCode, String newCode);

    List<Map<String, Object>> findEvents(Long memberId);

    void logEvent(Long memberId, String action, String detail);

    /** Gate lookup by gym-assigned member code (fingerprint/QR punch). */
    Optional<Map<String, Object>> findGateMemberByCode(String memberCode);

    /** Gate lookup by normalized RFID card UID. */
    Optional<Map<String, Object>> findGateMemberByCardUid(String cardUid);

    int updateFingerprintStatus(Long id, String status);
}
