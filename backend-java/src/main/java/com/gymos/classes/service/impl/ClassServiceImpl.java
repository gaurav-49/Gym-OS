package com.gymos.classes.service.impl;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import com.gymos.classes.dao.ClassDao;
import com.gymos.classes.service.ClassService;
import com.gymos.common.api.BusinessException;
import com.gymos.common.security.AuthUser;
import com.gymos.common.security.JwtService;
import com.gymos.common.security.LoginThrottleService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.member.dao.ClientDao;
import com.gymos.portal.service.MemberPortalService;
import com.gymos.notify.service.NotifyService;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Class service — booking core shared by staff and member routes, exact
 * messages/statuses from classesController.js. Member self-service tokens live
 * 12h, like the Node MEMBER_TOKEN_EXPIRY.
 */
@Service
public class ClassServiceImpl implements ClassService {

    private static final Logger log = LoggerFactory.getLogger(ClassServiceImpl.class);

    private static final long MEMBER_TOKEN_TTL = 12L * 60 * 60 * 1000;
    private static final String MEMBER_TOKEN_EXPIRY = "12h";
    private static final int MAX_SERIES_DAYS = 366;

    private final ClassDao classDao;
    private final ClientDao clientDao;
    private final JwtService jwtService;
    private final TransactionTemplate tx;
    private final LoginThrottleService loginThrottle;
    private final HttpServletRequest request;
    private final NotifyService notifyService;
    private final MemberPortalService memberPortalService;

    public ClassServiceImpl(ClassDao classDao, ClientDao clientDao, JwtService jwtService,
                            TransactionTemplate tx, LoginThrottleService loginThrottle,
                            HttpServletRequest request, NotifyService notifyService,
                            MemberPortalService memberPortalService) {
        this.classDao = classDao;
        this.clientDao = clientDao;
        this.jwtService = jwtService;
        this.tx = tx;
        this.loginThrottle = loginThrottle;
        this.request = request;
        this.notifyService = notifyService;
        this.memberPortalService = memberPortalService;
    }

    @Override
    public List<Map<String, Object>> getTrainers() {
        return classDao.findTrainers();
    }

    @Override
    public List<Map<String, Object>> getClasses(String includePast, Long memberId) {
        boolean past = includePast != null && !includePast.isEmpty() && !"0".equals(includePast);
        List<Map<String, Object>> rows = classDao.findClasses(past);
        for (Map<String, Object> row : rows) {
            row.putAll(classDao.counts(toLong(row.get("id"))));
            String my = null;
            if (memberId != null) {
                Optional<Map<String, Object>> mine = classDao.myStatus(toLong(row.get("id")), memberId);
                if (mine.isPresent()) my = String.valueOf(mine.get().get("status"));
            }
            row.put("my_status", my);
        }
        return rows;
    }

    @Override
    public Map<String, Object> getClassDetail(Long id) {
        Map<String, Object> cls = classDao.findById(id)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Class not found"));
        cls.putAll(classDao.counts(id));
        cls.put("bookings", classDao.findBookings(id));
        return cls;
    }

    @Override
    public Map<String, Object> createClass(Map<String, Object> body) {
        String name = Body.str(body, "name");
        if (name == null || name.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Class name is required");
        }
        String classDate = Body.str(body, "class_date");
        if (!Dates.isValidDateString(classDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "class_date must be a valid date in YYYY-MM-DD format");
        }
        // A class in the past cannot be booked, attended or cancelled, so it
        // only ever appears on the schedule as something nobody can act on.
        // Almost always a mistyped year or a stale date left in the form.
        if (classDate.compareTo(Dates.todayStr()) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "That date has already passed (" + Dates.friendly(classDate)
                    + "). Schedule the class for today or later.");
        }
        String startTime = Body.str(body, "start_time");
        if (!Dates.isTime(startTime)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "start_time must be in HH:mm format");
        }
        int cap = Body.toInt(body.get("capacity"));
        if (body.get("capacity") == null || cap < 1 || cap > 500) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "capacity must be between 1 and 500");
        }
        String endTime = Body.str(body, "end_time");
        String timeError = validateTimes(startTime, endTime);
        if (timeError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, timeError);
        String farError = validateNotAbsurdlyFar(classDate);
        if (farError != null) throw new BusinessException(HttpStatus.BAD_REQUEST, farError);
        Long trainerId = Body.toLong(body.get("trainer_id"));
        if (trainerId != null && classDao.findTrainers().stream().noneMatch(t -> toLong(t.get("id")).equals(trainerId))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Trainer not found");
        }
        return classDao.insertClass(name.trim(), Body.str(body, "description"), trainerId, classDate,
            startTime, endTime, cap);
    }

    @Override
    public Map<String, Object> createSeries(Map<String, Object> body) {
        String name = Body.str(body, "name");
        if (name == null || name.trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Class name is required");
        }
        int weekday = Body.toInt(body.get("weekday"));
        if (weekday < 0 || weekday > 6) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "weekday must be 0 (Sun) to 6 (Sat)");
        }
        String startDate = Body.str(body, "start_date");
        String endDate = Body.str(body, "end_date");
        if (!Dates.isValidDateString(startDate) || !Dates.isValidDateString(endDate) || endDate.compareTo(startDate) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Provide valid start_date and end_date (end >= start)");
        }
        String startTime = Body.str(body, "start_time");
        if (!Dates.isTime(startTime)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "start_time must be in HH:mm format");
        }
        int cap = Body.toInt(body.get("capacity"));
        if (body.get("capacity") == null || cap < 1 || cap > 500) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "capacity must be between 1 and 500");
        }
        LocalDate start = LocalDate.parse(startDate);
        LocalDate end = LocalDate.parse(endDate);
        if (ChronoUnit.DAYS.between(start, end) > MAX_SERIES_DAYS) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Series cannot span more than " + MAX_SERIES_DAYS + " days");
        }
        Long trainerId = Body.toLong(body.get("trainer_id"));
        if (trainerId != null && classDao.findTrainers().stream().noneMatch(t -> toLong(t.get("id")).equals(trainerId))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Trainer not found");
        }

        // JS getDay(): 0 (Sun) .. 6 (Sat) → java.time.DayOfWeek 1 (Mon) .. 7 (Sun).
        DayOfWeek target = weekday == 0 ? DayOfWeek.SUNDAY : DayOfWeek.of(weekday);
        String description = Body.str(body, "description");
        String endTime = Body.str(body, "end_time");
        int[] created = {0};
        tx.executeWithoutResult(status -> {
            for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
                if (d.getDayOfWeek() == target) {
                    classDao.insertClassBatch(name.trim(), description, trainerId, d.toString(),
                        startTime, endTime, cap);
                    created[0]++;
                }
            }
        });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Created " + created[0] + " session(s).");
        out.put("created", created[0]);
        return out;
    }

    @Override
    public Map<String, Object> updateClass(Long id, Map<String, Object> body) {
        if (classDao.findById(id).isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Class not found");
        }
        if (Body.containsKey(body, "name") && Body.str(body, "name").trim().isEmpty()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Class name cannot be empty");
        }
        String classDate = Body.str(body, "class_date");
        if (Body.containsKey(body, "class_date") && !Dates.isValidDateString(classDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "class_date must be a valid date in YYYY-MM-DD format");
        }
        String startTime = Body.str(body, "start_time");
        if (Body.containsKey(body, "start_time") && !Dates.isTime(startTime)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "start_time must be in HH:mm format");
        }
        if (Body.containsKey(body, "capacity")) {
            int cap = Body.toInt(body.get("capacity"));
            if (cap < 1 || cap > 500) {
                throw new BusinessException(HttpStatus.BAD_REQUEST, "capacity must be between 1 and 500");
            }
        }
        String status = Body.str(body, "status");
        if (Body.containsKey(body, "status") && !"active".equals(status) && !"cancelled".equals(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "status must be active or cancelled");
        }
        // Every rule create() applies, applied again here on the EFFECTIVE value —
        // otherwise editing a class was the way around all of them. A past date
        // was the worst: create refuses it, update accepted it, and the member
        // portal would then offer a class that had already happened.
        Map<String, Object> existing = classDao.findById(id)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Class not found"));
        String effDate = Body.containsKey(body, "class_date") ? classDate : str(existing.get("class_date"));
        String effStart = Body.containsKey(body, "start_time") ? startTime : str(existing.get("start_time"));
        String effEnd = Body.containsKey(body, "end_time") ? Body.str(body, "end_time") : str(existing.get("end_time"));
        if (Body.containsKey(body, "class_date") && effDate != null
            && effDate.compareTo(Dates.todayStr()) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "That date has already passed (" + Dates.friendly(effDate)
                    + "). Schedule the class for today or later.");
        }
        String timeError2 = validateTimes(effStart, effEnd);
        if (timeError2 != null) throw new BusinessException(HttpStatus.BAD_REQUEST, timeError2);
        String farError2 = validateNotAbsurdlyFar(effDate);
        if (farError2 != null) throw new BusinessException(HttpStatus.BAD_REQUEST, farError2);

        // Capacity below the number already in the room leaves those bookings
        // stranded: the class reads as over-subscribed and the waitlist can
        // never drain.
        if (Body.containsKey(body, "capacity")) {
            int newCap = Body.toInt(body.get("capacity"));
            int booked = Body.toInt(classDao.counts(id).get("booked"));
            if (newCap < booked) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "Capacity cannot be less than the " + booked
                        + " member(s) already booked. Cancel a booking first, or set it to " + booked + " or more.");
            }
        }

        Long trainerId = Body.containsKey(body, "trainer_id") ? Body.toLong(body.get("trainer_id")) : null;
        if (trainerId != null && classDao.findTrainers().stream().noneMatch(t -> toLong(t.get("id")).equals(trainerId))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Trainer not found");
        }
        return classDao.updateClass(id,
            Body.containsKey(body, "name") ? Body.str(body, "name") : null,
            Body.containsKey(body, "description") ? Body.str(body, "description") : null,
            trainerId,
            Body.containsKey(body, "class_date") ? classDate : null,
            Body.containsKey(body, "start_time") ? startTime : null,
            Body.containsKey(body, "end_time") ? Body.str(body, "end_time") : null,
            Body.containsKey(body, "capacity") ? Body.toInt(body.get("capacity")) : null,
            Body.containsKey(body, "status") ? status : null);
    }

    /** A class that ends before it starts. Accepted silently until now (18:00-09:00). */
    private String validateTimes(String start, String end) {
        if (start == null || end == null || start.isBlank() || end.isBlank()) return null;
        String s = start.length() >= 5 ? start.substring(0, 5) : start;
        String e = end.length() >= 5 ? end.substring(0, 5) : end;
        if (e.compareTo(s) <= 0) {
            return "The class cannot end at " + e + " when it starts at " + s + ".";
        }
        return null;
    }

    /** A five-year horizon. 9999-12-31 is a typo, not a timetable. */
    private String validateNotAbsurdlyFar(String classDate) {
        if (classDate == null || classDate.isBlank()) return null;
        String limit = Dates.addDays(Dates.todayStr(), 365 * 5);
        if (classDate.compareTo(limit) > 0) {
            return "That date is more than five years away (" + Dates.friendly(classDate) + "). Check the year.";
        }
        return null;
    }

    private static String str(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    @Override
    public Map<String, Object> deleteClass(Long id) {
        if (classDao.cancelClass(id) == 0) {
            Optional<String> status = classDao.findStatusById(id);
            if (status.isEmpty()) {
                throw new BusinessException(HttpStatus.NOT_FOUND, "Class not found");
            }
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Class is already cancelled");
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Class cancelled.");
        return out;
    }

    @Override
    public Map<String, Object> book(Long classId, Long memberId) {
        return createBooking(classId, memberId);
    }

    @Override
    public Map<String, Object> cancelBooking(Long classId, Long memberId) {
        return cancelBookingCore(classId, memberId);
    }

    @Override
    public Map<String, Object> verifyMember(String memberCode, String password) {
        // One credential check for the whole member surface: the booking page
        // is a second front door to the same account, not a lesser one.
        return memberPortalService.login(memberCode, password);
    }

    @Override
    public List<Map<String, Object>> memberClasses(Long memberId) {
        List<Map<String, Object>> rows = classDao.memberClasses(memberId);
        for (Map<String, Object> row : rows) {
            row.putAll(classDao.counts(toLong(row.get("id"))));
            Optional<Map<String, Object>> mine = classDao.myStatus(toLong(row.get("id")), memberId);
            row.put("my_status", mine.map(m -> String.valueOf(m.get("status"))).orElse(null));
        }
        return rows;
    }

    @Override
    public List<Map<String, Object>> myBookings(Long memberId) {
        return classDao.myBookings(memberId);
    }

    @Override
    public Map<String, Object> memberBook(Long classId, Long memberId) {
        return createBooking(classId, memberId);
    }

    @Override
    public Map<String, Object> memberCancel(Long classId, Long memberId) {
        return cancelBookingCore(classId, memberId);
    }

    // ---- shared booking core ---------------------------------------------------

    private Map<String, Object> createBooking(Long classId, Long memberId) {
        Map<String, Object> cls = classDao.findById(classId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Class not found"));
        if (!"active".equals(String.valueOf(cls.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "This class has been cancelled.");
        }
        // A class that has already run cannot be joined. The schedule stops
        // offering past classes, but the endpoint accepted one by id — and a
        // booking made after the fact counts towards nothing and cannot be
        // attended.
        String held = String.valueOf(cls.get("class_date"));
        if (held.compareTo(Dates.todayStr()) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "That class was held on " + Dates.friendly(held) + " and can no longer be booked.");
        }
        memberBookable(memberId);

        Optional<Map<String, Object>> existing = classDao.findActiveBooking(classId, memberId);
        if (existing.isPresent()) {
            String current = String.valueOf(existing.get().get("status"));
            throw new BusinessException(HttpStatus.CONFLICT,
                "Member is already " + ("waitlisted".equals(current) ? "on the waitlist" : "booked")
                    + " for this class.");
        }

        Map<String, Object> counts = classDao.counts(classId);
        int booked = ((Number) counts.get("booked")).intValue();
        int capacity = ((Number) cls.get("capacity")).intValue();
        String status = booked < capacity ? "booked" : "waitlisted";
        classDao.upsertBooking(classId, memberId, status);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("status", status);
        out.put("className", cls.get("name"));
        // Who this is, so the controller's confirmation can name a person
        // rather than echo clients.id back at the desk.
        classDao.findMemberName(memberId).ifPresent(name -> out.put("memberName", name));
        // Being told "you're waitlisted" without a position is the complaint that
        // drives people to book elsewhere. Say where they actually are.
        if ("waitlisted".equals(status)) {
            classDao.waitlistPosition(classId, memberId)
                .ifPresent(position -> out.put("waitlist_position", position));
        }
        return out;
    }

    private Map<String, Object> cancelBookingCore(Long classId, Long memberId) {
        if (classDao.cancelBooking(classId, memberId) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND,
                "No active booking found for this member in this class.");
        }
        String promoted = null;
        Optional<Map<String, Object>> waitlisted = classDao.firstWaitlisted(classId);
        if (waitlisted.isPresent()) {
            Optional<Long> up = classDao.promoteWaitlisted(toLong(waitlisted.get().get("id")));
            if (up.isPresent()) {
                promoted = classDao.findMemberName(up.get()).orElse(null);
                notifyPromotion(up.get(), classId);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("promoted", promoted);
        return out;
    }

    /**
     * Tell a promoted member they got the seat.
     *
     * <p>1.0 promoted silently, so someone who waitlisted on Monday found out on
     * Thursday by checking the app — which is the same as not being promoted.
     * Never throws: a failed message must not roll back the cancellation that
     * triggered it.
     */
    private void notifyPromotion(Long memberId, Long classId) {
        try {
            Map<String, Object> cls = classDao.findById(classId).orElse(null);
            Map<String, Object> member = classDao.findMemberContact(memberId).orElse(null);
            if (cls == null || member == null) {
                return;
            }
            String message = "Good news " + member.get("name") + " — a place opened up in "
                + cls.get("name") + " on " + cls.get("class_date") + " at " + cls.get("start_time")
                + ". You're now booked in.";
            Object phone = member.get("phone");
            if (phone != null && !String.valueOf(phone).isBlank()) {
                notifyService.sendWhatsApp(String.valueOf(phone), message);
            }
            Object email = member.get("email");
            if (email != null && !String.valueOf(email).isBlank()) {
                notifyService.sendNotificationEmail(String.valueOf(email),
                    "You're in: " + cls.get("name"), message);
            }
        } catch (Exception e) {
            log.warn("could not notify member {} of their class promotion: {}", memberId, e.getMessage());
        }
    }

    private void memberBookable(Long memberId) {
        Map<String, Object> m = classDao.findMemberBookable(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        if (!"active".equals(String.valueOf(m.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Member " + m.get("name") + " is inactive and cannot book classes.");
        }
        String today = Dates.todayStr();
        if (m.get("frozen_until") != null && String.valueOf(m.get("frozen_until")).compareTo(today) >= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Member " + m.get("name") + " is frozen until " + m.get("frozen_until")
                    + " and cannot book classes.");
        }
        if (m.get("membership_expiry") != null
            && String.valueOf(m.get("membership_expiry")).compareTo(today) < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Membership for " + m.get("name") + " expired on " + m.get("membership_expiry")
                    + ". Renew to book classes.");
        }
    }

    private static String digits(String s) {
        if (s == null) return "";
        return s.replaceAll("\\D", "");
    }

    private static Long toLong(Object v) {
        return v instanceof Number n ? n.longValue() : Long.parseLong(String.valueOf(v));
    }
}
