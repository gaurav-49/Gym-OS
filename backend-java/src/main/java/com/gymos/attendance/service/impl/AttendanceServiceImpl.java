package com.gymos.attendance.service.impl;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.attendance.dao.AttendanceDao;
import com.gymos.common.api.BusinessException;
import com.gymos.attendance.service.AttendanceService;
import com.gymos.attendance.service.GateException;
import com.gymos.common.util.Dates;
import com.gymos.member.dao.ClientDao;

@Service
public class AttendanceServiceImpl implements AttendanceService {

    private static final DateTimeFormatter TO_DATE_STRING = DateTimeFormatter.ofPattern("EEE MMM dd yyyy", Locale.ENGLISH);

    private final AttendanceDao attendanceDao;
    private final ClientDao clientDao;

    public AttendanceServiceImpl(AttendanceDao attendanceDao, ClientDao clientDao) {
        this.attendanceDao = attendanceDao;
        this.clientDao = clientDao;
    }

    /**
     * Every rule that decides whether someone gets through the door, in one
     * place so that fingerprint, card, QR and the manual form cannot drift
     * apart. Order matters only for which message the member hears first.
     */
    private void enforceGate(Map<String, Object> member) {
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new GateException("MEMBER_INACTIVE",
                "Member " + member.get("name") + " is inactive.");
        }
        String today = Dates.todayStr();
        if (member.get("frozen_until") != null
            && String.valueOf(member.get("frozen_until")).compareTo(today) >= 0) {
            throw new GateException("MEMBER_FROZEN",
                "Member " + member.get("name") + " is frozen until " + member.get("frozen_until")
                    + ". The gate stays locked until the freeze ends.");
        }
        BigDecimal due = toDecimal(member.get("amount_due"));
        if (due.signum() > 0) {
            throw new GateException("DUES_PENDING",
                "Member " + member.get("name") + " has an outstanding balance of ₹"
                    + due.toPlainString() + ". Clear the dues to unlock the gate.");
        }
        if (member.get("membership_expiry") != null
            && String.valueOf(member.get("membership_expiry")).compareTo(today) < 0) {
            throw new GateException("EXPIRED",
                "Membership for " + member.get("name") + " expired on "
                    + member.get("membership_expiry") + ". Renew the membership to reactivate access.");
        }
    }

    @Override
    public Map<String, Object> mark(String memberId, String memberName, String date, String time,
                                    String status, String source, Map<String, Object> member) {
        String normalizedDate = Dates.formatDateForPostgres(date);
        if (!Dates.isValidDateString(normalizedDate)) {
            throw new GateException("INVALID_DATE", "Date must be in YYYY-MM-DD format");
        }
        // Attendance is a record of someone who was in the building. A date in
        // the future is a typed year, and it counts towards nothing until then.
        if (Dates.futureError("attendance date", normalizedDate) != null) {
            throw new GateException("INVALID_DATE",
                "Attendance cannot be marked for a future date (" + Dates.friendly(normalizedDate) + ").");
        }

        Map<String, Object> resolvedMember = member;
        if (resolvedMember == null && memberId != null) {
            resolvedMember = clientDao.findGateMemberByCode(memberId).orElse(null);
        }

        // The gate runs on the member, never on how they were identified.
        //
        // These four checks used to sit behind "was a member_name supplied?",
        // which meant the manual attendance form — the one path that always
        // sends a name — skipped every one of them. A member with unpaid dues
        // was refused by the fingerprint reader and the QR scanner, and then
        // marked present by someone typing their name at the desk. There is no
        // instalment plan in this product: unpaid is unpaid, on every door.
        if (resolvedMember == null) {
            throw new GateException("MEMBER_NOT_FOUND", "Member not found. Register the member before punching.");
        }
        enforceGate(resolvedMember);
        String resolvedName = String.valueOf(resolvedMember.get("name")).toUpperCase();
        memberId = String.valueOf(resolvedMember.get("member_code"));

        Optional<Map<String, Object>> existing = attendanceDao.findByMemberAndDate(memberId, normalizedDate);
        if (existing.isPresent()) {
            Map<String, Object> rec = existing.get();
            String day = LocalDate.parse(normalizedDate).format(TO_DATE_STRING);
            throw new GateException("DUPLICATE",
                "Attendance already marked for " + rec.get("member_name") + " on " + day + " at " + rec.get("time") + ".");
        }

        return attendanceDao.insert(memberId, resolvedName, normalizedDate, time,
            validStatus(status), source == null ? "manual" : source);
    }

    /**
     * The two values the form offers and the list renders. It was free text:
     * whatever arrived in the body was written to the column, so a string of
     * markup became a member's attendance status and every chip that colours
     * on {@code status === 'Present'} silently fell to the 'Absent' branch.
     * Matched without regard to case and stored canonically, because the
     * column already holds "Present"/"Absent" and a lower-case variant would
     * be a third value in practice.
     */
    private static final Map<String, String> STATUSES = Map.of(
        "present", "Present",
        "absent", "Absent");

    private static String validStatus(String raw) {
        if (raw == null || raw.isBlank()) {
            return "Present";
        }
        String canonical = STATUSES.get(raw.trim().toLowerCase(Locale.ROOT));
        if (canonical == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be Present or Absent.");
        }
        return canonical;
    }

    @Override
    public List<Map<String, Object>> findAll() {
        return attendanceDao.findAll();
    }

    @Override
    public List<Map<String, Object>> report(String from, String to, String memberId, String status, String source) {
        return attendanceDao.report(from, to, memberId, status, source);
    }

    private static BigDecimal toDecimal(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        try {
            return new BigDecimal(String.valueOf(v));
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }
}
