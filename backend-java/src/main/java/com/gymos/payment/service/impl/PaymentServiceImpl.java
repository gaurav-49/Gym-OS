package com.gymos.payment.service.impl;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import com.gymos.common.api.BusinessException;
import com.gymos.common.util.Body;
import com.gymos.common.util.Dates;
import com.gymos.member.dao.ClientDao;
import com.gymos.payment.dao.PaymentContext;
import com.gymos.payment.dao.PaymentDao;
import com.gymos.referrals.service.ReferralService;
import com.gymos.payment.service.PaymentService;

@Service
public class PaymentServiceImpl implements PaymentService {

    private static final List<String> PAYMENT_MODES = List.of("Cash", "UPI", "Card", "Bank Transfer", "Online");
    private static final String MODE_ERROR = "method must be one of: Cash, UPI, Card, Bank Transfer, Online";

    private final PaymentDao paymentDao;
    private final ReferralService referralService;
    private final ClientDao clientDao;

    public PaymentServiceImpl(PaymentDao paymentDao, ClientDao clientDao, ReferralService referralService) {
        this.paymentDao = paymentDao;
        this.referralService = referralService;
        this.clientDao = clientDao;
    }

    @Override
    public List<Map<String, Object>> list(Long memberId) {
        return paymentDao.findAll(memberId);
    }

    @Override
    public Map<String, Object> create(Long memberId, String amount, String paymentDate, String method, String note) {
        if (memberId == null || amount == null || toDecimal(amount).signum() <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "member_id and a positive amount are required");
        }
        if (paymentDate != null && !Dates.isValidDateString(paymentDate)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "payment_date must be a valid date in YYYY-MM-DD format");
        }
        // A receipt dated in the future is money the gym has not been given.
        // It also lands in next month's takings, so the books stop matching
        // the till on the day it is entered.
        if (paymentDate != null && paymentDate.compareTo(Dates.todayStr()) > 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST,
                "A payment cannot be dated in the future (" + Dates.friendly(paymentDate) + ").");
        }
        if (!isValidMode(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, MODE_ERROR);
        }
        if (clientDao.findById(memberId).isEmpty()) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Member not found");
        }
        BigDecimal amountDec = toDecimal(amount);
        // Money taken at the desk for a reason the note carries — a locker, a
        // day pass, a part payment. It buys no term of its own, so the receipt
        // prints the note rather than inventing a plan for it.
        Map<String, Object> inserted = paymentDao.insert(memberId, amountDec,
            paymentDate == null ? Dates.todayStr() : paymentDate, method == null ? "Cash" : method, note,
            PaymentContext.other());
        paymentDao.reduceDue(memberId, amountDec);
        // This may be the payment that finally clears a referred member's
        // dues, which is what earns the person who introduced them.
        referralService.settleForMember(memberId);
        return inserted;
    }

    @Override
    public Map<String, Object> collectDue(Long memberId, String method) {
        Map<String, Object> m = clientDao.findById(memberId)
            .orElseThrow(() -> new BusinessException(HttpStatus.NOT_FOUND, "Member not found"));
        // amount_due alone — the same number the Outstanding Dues list shows.
        // Taking the GREATER of this and (fee - amount_paid) let the desk collect
        // an amount the screen never displayed, against a member it never listed.
        BigDecimal due = max0(toDecimalOr0(m.get("amount_due")));
        if (due.signum() <= 0) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, m.get("name") + " has no outstanding dues.");
        }
        if (!isValidMode(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, MODE_ERROR);
        }
        String mode = method == null ? str(m, "payment_mode") == null ? "Cash" : str(m, "payment_mode") : method;
        Map<String, Object> inserted = paymentDao.insert(memberId, due, Dates.todayStr(), mode,
            "Outstanding dues collected", PaymentContext.dues());
        paymentDao.clearDues(memberId, mode);
        referralService.settleForMember(memberId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", "Collected ₹" + due.toPlainString() + " from " + m.get("name") + ". Dues cleared.");
        res.put("amount", due);
        res.put("member", m.get("name"));
        res.put("payment", inserted);
        return res;
    }

    @Override
    public Map<String, Object> collectAll(String method) {
        if (!isValidMode(method)) {
            throw new BusinessException(HttpStatus.BAD_REQUEST, MODE_ERROR);
        }
        BigDecimal collected = BigDecimal.ZERO;
        int count = 0;
        for (Map<String, Object> m : paymentDao.membersWithDues()) {
            // See collectDue: amount_due is the single definition of "owed".
            BigDecimal due = max0(toDecimalOr0(m.get("amount_due")));
            if (due.signum() <= 0) continue;
            String mode = method == null ? str(m, "payment_mode") == null ? "Cash" : str(m, "payment_mode") : method;
            paymentDao.insert(Body.toLong(m.get("id")), due, Dates.todayStr(), mode,
                "Outstanding dues collected", PaymentContext.dues());
            paymentDao.clearDues(Body.toLong(m.get("id")), mode);
            collected = collected.add(due);
            count++;
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("message", "Collected ₹" + collected.toPlainString() + " from " + count + " member(s).");
        res.put("count", count);
        res.put("amount", collected);
        return res;
    }

    @Override
    public void delete(Long id) {
        if (paymentDao.delete(id) == 0) {
            throw new BusinessException(HttpStatus.NOT_FOUND, "Payment not found");
        }
    }

    private static boolean isValidMode(String value) {
        if (value == null || value.isEmpty()) return true;
        return PAYMENT_MODES.contains(value.trim());
    }

    private static BigDecimal toDecimal(String v) {
        try {
            return new BigDecimal(v.trim());
        } catch (NumberFormatException e) {
            return BigDecimal.ZERO;
        }
    }

    private static BigDecimal toDecimalOr0(Object v) {
        BigDecimal d = Body.toDecimal(v);
        return d == null ? BigDecimal.ZERO : d;
    }

    private static BigDecimal max0(BigDecimal v) {
        return v.signum() < 0 ? BigDecimal.ZERO : v;
    }

    private static String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
