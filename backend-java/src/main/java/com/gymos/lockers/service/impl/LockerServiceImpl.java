package com.gymos.lockers.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.audit.AuditService;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.invoices.service.InvoiceService;
import com.gymos.lockers.dao.LockerDao;
import com.gymos.lockers.service.LockerService;
import com.gymos.member.dao.ClientDao;
import com.gymos.payment.dao.PaymentContext;
import com.gymos.payment.dao.PaymentDao;
import com.gymos.common.util.PaymentModes;

@Service
public class LockerServiceImpl implements LockerService {

    private static final List<String> SIZES = List.of("Small", "Medium", "Large");
    private static final List<String> STATUSES = List.of("free", "occupied", "maintenance");
    private static final int MAX_MONTHS = 36;

    private final LockerDao lockerDao;
    private final ClientDao clientDao;
    private final PaymentDao paymentDao;
    private final InvoiceService invoiceService;
    private final AuditService audit;

    public LockerServiceImpl(LockerDao lockerDao, ClientDao clientDao, PaymentDao paymentDao,
                             InvoiceService invoiceService, AuditService audit) {
        this.lockerDao = lockerDao;
        this.clientDao = clientDao;
        this.paymentDao = paymentDao;
        this.invoiceService = invoiceService;
        this.audit = audit;
    }

    @Override
    public List<Map<String, Object>> list(String status, String search) {
        return lockerDao.findLockers(status, search);
    }

    @Override
    public Map<String, Object> create(Map<String, Object> body) {
        String raw = Body.str(body, "locker_number");
        if (raw == null || raw.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Locker number is required");
        }
        String size = Body.str(body, "size");
        requireSize(size, true);
        BigDecimal rent = requireRent(body);

        String number = raw.trim().toUpperCase();
        lockerDao.findByNumber(number).ifPresent(clash -> {
            throw new BusinessException(HttpStatus.CONFLICT, "Locker " + number + " already exists.");
        });

        Map<String, Object> locker = lockerDao.insert(number,
            Body.str(body, "location"),
            size == null ? "Medium" : size,
            rent == null ? BigDecimal.ZERO : rent,
            Body.str(body, "notes"));
        audit.record("create", "lockers", locker.get("id"), "Added locker " + number);
        return locker;
    }

    @Override
    public Map<String, Object> update(Long id, Map<String, Object> body) {
        String size = body.containsKey("size") ? Body.str(body, "size") : null;
        requireSize(size, false);
        String status = body.containsKey("status") ? Body.str(body, "status") : null;
        if (status != null && !STATUSES.contains(status)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "status must be one of: " + String.join(", ", STATUSES));
        }
        BigDecimal rent = requireRent(body);

        Map<String, Object> existing = lockerDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Locker not found"));
        String number = String.valueOf(existing.get("locker_number"));
        boolean assigned = existing.get("member_id") != null;

        // Taking an assigned locker out of service would strand the member's
        // belongings in the records — release it first.
        if ("maintenance".equals(status) && assigned) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Locker " + number + " is assigned. Release it before marking it under maintenance.");
        }
        if ("occupied".equals(status) && !assigned) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Assign the locker to a member to mark it occupied.");
        }
        // The third case, which was missing: 'free' while a member is still
        // attached. It leaves a row that is free by its status and occupied by
        // its member_id, and every path that reads one of the two disagrees —
        // assign refuses it (member_id is set), release refuses it (the board
        // shows it free), so the locker becomes both unassignable and
        // unreleasable. Release is the operation that clears both together.
        if ("free".equals(status) && assigned) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Locker " + number + " is still assigned. Release it to make it free.");
        }

        Map<String, Object> updated = lockerDao.update(id,
            body.containsKey("location") ? Body.str(body, "location") : null,
            size, rent,
            body.containsKey("notes") ? Body.str(body, "notes") : null,
            status);
        audit.record("update", "lockers", id, "Updated locker " + number);
        return updated;
    }

    @Override
    public Map<String, Object> assign(Long id, Map<String, Object> body) {
        Long memberId = Body.toLong(body.get("member_id"));
        if (memberId == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "member_id is required");
        }
        String assignedUntil = Body.str(body, "assigned_until");
        if (assignedUntil != null && !assignedUntil.isBlank() && !Dates.isValidDateString(assignedUntil)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "assigned_until must be a valid date in YYYY-MM-DD format");
        }
        // The assignment starts today, so an end date already in the past is a
        // locker handed over expired — it showed as occupied and overdue at once.
        String lockerOrder = Dates.orderError("start date", Dates.todayStr(),
            "end date", assignedUntil);
        if (lockerOrder != null) throw new BusinessException(HttpStatus.BAD_REQUEST, lockerOrder);
        Integer months = null;
        if (body.get("months") != null && !String.valueOf(body.get("months")).isBlank()) {
            months = Body.toInt(body.get("months"));
            if (months < 1 || months > MAX_MONTHS) {
                throw new BusinessException(HttpStatus.BAD_REQUEST,
                    "months must be a whole number between 1 and " + MAX_MONTHS);
            }
        }

        Map<String, Object> locker = lockerDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Locker not found"));
        String number = String.valueOf(locker.get("locker_number"));
        if ("maintenance".equals(String.valueOf(locker.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Locker " + number + " is under maintenance.");
        }
        if (locker.get("member_id") != null) {
            throw new BusinessException(HttpStatus.CONFLICT,
                "Locker " + number + " is already assigned. Release it first.");
        }

        Map<String, Object> member = clientDao.findById(memberId).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        String memberName = String.valueOf(member.get("name"));
        if (!"active".equals(String.valueOf(member.get("status")))) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                memberName + " is inactive — reactivate the membership first.");
        }
        // One locker per member: two lockers under one name is almost always a
        // data-entry slip, and the member page can only show one.
        lockerDao.findHeldBy(memberId).ifPresent(held -> {
            throw new BusinessException(HttpStatus.CONFLICT,
                memberName + " already holds locker " + held.get("locker_number") + ".");
        });

        String from = Dates.todayStr();
        String until = assignedUntil != null && !assignedUntil.isBlank()
            ? assignedUntil
            : Dates.addDays(from, 30 * (months == null ? 1 : months));

        // A charge is optional — a gym that includes lockers in the membership
        // assigns one without taking anything — but when money does change
        // hands it goes into the same ledger as every other rupee, and the
        // member gets the same document they get for anything else they buy.
        BigDecimal charge = Body.toDecimal(body.get("amount"));
        if (charge != null && charge.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "amount must be a non-negative number");
        }
        String method = Body.str(body, "method");
        if (charge != null && charge.signum() > 0 && !PaymentModes.isValid(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, PaymentModes.ERROR);
        }
        if (charge != null && charge.signum() > 0) {
            lockerDao.update(id, null, null, charge, null, null);
        }

        Map<String, Object> updated = lockerDao.assign(id, memberId, from, until);
        Map<String, Object> invoice = charge != null && charge.signum() > 0
            ? chargeFor(updated, member, charge, method, from, until) : null;

        audit.record("assign", "lockers", id, "Assigned locker " + number + " to " + memberName
            + " (ID " + member.get("member_code") + ") until " + until
            + (invoice == null ? "" : " — \u20b9" + charge.toPlainString() + " taken, "
                + invoice.get("invoice_no") + " raised"));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Locker " + number + " assigned to " + memberName + " until " + until + "."
            + (invoice == null ? "" : " \u20b9" + charge.toPlainString() + " collected — "
                + invoice.get("invoice_no") + "."));
        out.put("locker", updated);
        out.put("invoice", invoice);
        return out;
    }

    /**
     * The money side of taking a locker: one payment in the ledger and one
     * numbered invoice, both naming the locker and the period it covers.
     */
    private Map<String, Object> chargeFor(Map<String, Object> locker, Map<String, Object> member,
                                          BigDecimal amount, String method, String from, String until) {
        Long lockerId = Body.toLong(locker.get("id"));
        String number = String.valueOf(locker.get("locker_number"));
        String mode = method == null || method.isBlank() ? "Cash" : method;

        paymentDao.insert(Body.toLong(member.get("id")), amount, Dates.todayStr(), mode,
            "Locker " + number + " rent", PaymentContext.locker(lockerId, number, from, until));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("member_id", member.get("id"));
        body.put("customer_name", member.get("name"));
        body.put("invoice_date", Dates.todayStr());
        body.put("method", mode);
        body.put("notes", "Locker " + number + ", " + Dates.friendly(from) + " to " + Dates.friendly(until));
        body.put("items", List.of(Map.of(
            "description", "Locker " + number + " rent",
            "quantity", 1,
            "unit_price", amount,
            "tax_rate", 0)));
        Map<String, Object> invoice = invoiceService.create(body, null);
        // An invoice is issued first and settled second — but the money was
        // taken in the same breath here, so it is settled immediately rather
        // than left sitting in the unpaid list for somebody to chase.
        return invoiceService.update(Body.toLong(invoice.get("id")),
            Map.of("status", "paid", "method", mode));
    }

    @Override
    public Map<String, Object> assignByNumber(Long memberId, Map<String, Object> body) {
        String raw = Body.str(body, "locker_number");
        if (raw == null || raw.isBlank()) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, "Locker number is required");
        }
        String number = raw.trim().toUpperCase();

        // The desk types a number, not an id, and often the locker itself has
        // never been entered — so it is created on the spot rather than the
        // signup failing on a locker that physically exists on the wall.
        Map<String, Object> locker = lockerDao.findByNumber(number).orElseGet(() -> {
            BigDecimal rent = Body.toDecimal(body.get("amount"));
            Map<String, Object> made = lockerDao.insert(number, null, "Medium",
                rent == null ? BigDecimal.ZERO : rent, "Added while assigning at the desk");
            audit.record("create", "lockers", made.get("id"),
                "Added locker " + number + " while assigning it");
            return made;
        });

        Map<String, Object> forAssign = new LinkedHashMap<>(body);
        forAssign.put("member_id", memberId);
        return assign(Body.toLong(locker.get("id")), forAssign);
    }

    @Override
    public Map<String, Object> releaseHeldBy(Long memberId) {
        return lockerDao.findHeldBy(memberId)
            .map(held -> release(Body.toLong(held.get("id"))))
            .orElseGet(LinkedHashMap::new);
    }

    @Override
    public Map<String, Object> release(Long id) {
        Map<String, Object> locker = lockerDao.findByIdWithMember(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Locker not found"));
        String number = String.valueOf(locker.get("locker_number"));
        if (locker.get("member_id") == null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Locker " + number + " is not assigned to anyone.");
        }
        Object memberName = locker.get("member_name");
        Map<String, Object> updated = lockerDao.release(id);
        audit.record("release", "lockers", id,
            "Released locker " + number + " from " + (memberName == null ? "member" : memberName));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Locker " + number + " released and available again.");
        out.put("locker", updated);
        return out;
    }

    @Override
    public Map<String, Object> delete(Long id) {
        Map<String, Object> locker = lockerDao.findById(id).orElseThrow(() ->
            new BusinessException(HttpStatus.NOT_FOUND, "Locker not found"));
        String number = String.valueOf(locker.get("locker_number"));
        if (locker.get("member_id") != null) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "Locker " + number + " is assigned — release it before deleting.");
        }
        lockerDao.delete(id);
        audit.record("delete", "lockers", id, "Deleted locker " + number);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "Locker " + number + " deleted.");
        out.put("locker", locker);
        return out;
    }

    /** {@code onCreate} lets create default a blank size while update leaves it alone. */
    private static void requireSize(String size, boolean onCreate) {
        if (size == null || (onCreate && size.isBlank())) {
            return;
        }
        if (!SIZES.contains(size)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "size must be one of: " + String.join(", ", SIZES));
        }
    }

    private static BigDecimal requireRent(Map<String, Object> body) {
        Object raw = body.get("monthly_rent");
        if (raw == null || String.valueOf(raw).isBlank()) {
            return null;
        }
        BigDecimal rent = Body.toDecimal(raw);
        if (rent == null || rent.signum() < 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "monthly_rent must be a non-negative number");
        }
        return rent;
    }
}
