// frontend/src/components/ui/receipt.js
// One payment, as a document the member can keep.
//
// The paper, the masthead, the money formatting and the small print all come
// from printDoc.js, which the invoice uses too — a member handed both in the
// same visit should not be able to tell they were written by different people.
//
// Everything this states about what was bought comes off the payment row
// itself (purpose, plan_name, period, discount). It used to be inferred from
// the member's *current* membership, so a ₹9,000 personal-training receipt
// announced "Plan: Yearly, valid until 11 August 2027" — the membership the
// member happened to hold, not the thing the money bought. A receipt may only
// say what it can prove; where a fact is missing the line is left off rather
// than filled in with a plausible one.

import {
    amountInWords, daysBetween, esc, footerHtml, longDate, mastheadHtml,
    openPrintable, rupees, shortDate,
} from './printDoc';

const num = (v) => Number(v || 0);

/** RCPT-000123 — stable, because it is the payment's own id. */
export const receiptNo = (payment) => `RCPT-${String(payment?.id ?? 0).padStart(6, '0')}`;

// ---- what the payment bought ------------------------------------------------

/**
 * The description block, built from the payment row alone.
 *
 * @param payment  a payments row: purpose, plan_name, period_start/end, note
 * @param extra    {subscription} — the PT subscription this paid for, when the
 *                 caller has it, purely to name the trainer and the term
 */
const describe = (payment, extra = {}) => {
    const purpose = payment.purpose || '';
    const plan = payment.plan_name;
    const note = String(payment.note || '');
    const sub = extra.subscription;
    const term = daysBetween(payment.period_start, payment.period_end);
    const lines = [];

    if (purpose === 'pt') {
        const monthly = term && term > 0
            ? (num(payment.amount) + num(payment.discount)) / (term / 30) : null;
        if (sub?.plan_type) lines.push(`${sub.plan_type} personal training plan`);
        if (sub?.trainer_name) lines.push(`Trainer: ${sub.trainer_name}`);
        if (monthly) lines.push(`${rupees(monthly)} per month · ${term} days of training`);
        return { title: `Personal training — ${plan || 'package'}`, lines };
    }
    if (purpose === 'locker') {
        if (term && term > 0) lines.push(`${term} days of locker rental`);
        return { title: `Locker rent — ${plan ? plan.replace(/^Locker /, '') : 'locker'}`, lines };
    }
    if (purpose === 'dues') {
        return {
            title: 'Outstanding balance settled',
            // It buys no new term: the term was sold by an earlier payment, and
            // saying otherwise would have the member paying for it twice.
            lines: ['Cleared against the membership already running.'],
        };
    }
    if (purpose === 'membership') {
        const kind = /renew/i.test(note) ? 'Membership renewal'
            : /upgrade/i.test(note) ? 'Plan upgrade'
                : /auto-renewal/i.test(note) ? 'Automatic renewal'
                    : 'Membership fee';
        if (term && term > 0) lines.push(`${kind} · ${term} days`);
        else lines.push(kind);
        return { title: `Membership — ${plan || 'plan'}`, lines };
    }
    // Anything taken at the desk for a reason of its own says so in the note.
    const [first, ...others] = note.split('\n').filter(Boolean);
    return { title: first || 'Payment received', lines: others };
};

/**
 * The same description the receipt prints, for tables that list payments.
 * Shared so a row and its receipt can never disagree about what was bought.
 *
 * @returns {{title: string, lines: string[], period: string}}
 */
export const describePayment = (payment, extra = {}) => ({
    ...describe(payment, extra),
    period: payment.period_start && payment.period_end
        ? `${shortDate(payment.period_start)} – ${shortDate(payment.period_end)}` : '',
});

/**
 * @param payment  one row from /member/me payments (or the staff payments list)
 * @param member   the member: name, member_code, phone, amount_due
 * @param brand    useBranding() output — the gym's own identity, never "GYM OS"
 * @param extra    {subscription} for a PT payment, when the caller has it
 * @returns false if the pop-up was blocked; the caller shows the fallback
 */
export const printReceipt = (payment, member, brand, extra = {}) => {
    const item = describePayment(payment, extra);
    const period = item.period;
    const discount = num(payment.discount);
    const received = num(payment.amount);
    const charged = received + discount;

    // The note carries the referral-reward wording when one was applied, so it
    // has to survive into the receipt with its line breaks intact. Its first
    // line, though, is the boilerplate the description already says better
    // ("PT package: X", "Membership renewal") — printed underneath as well it
    // reads like a second thing was bought.
    const rawNote = String(payment.note || '').split('\n').filter(Boolean);
    const noteLines = (payment.purpose && payment.purpose !== 'other' ? rawNote.slice(1) : rawNote)
        .filter(l => l !== item.title);

    const due = num(member.amount_due ?? member.member_amount_due);
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const html = `
    ${mastheadHtml(brand, 'Payment receipt', receiptNo(payment), longDate(payment.payment_date))}

    <div class="parties">
      <div>
        <div class="label">Received from</div>
        <div class="who">${esc(member.name)}</div>
        <div class="muted">Member ID ${esc(member.member_code)}${
    member.phone ? `  ·  ${esc(member.phone)}` : ''}</div>
      </div>
      <div class="stamp">Paid</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>${period ? 'Period covered' : ''}</th>
          <th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="item">${esc(item.title)}</div>
            ${item.lines.map(l => `<div class="sub">${esc(l)}</div>`).join('')}
          </td>
          <td class="sub" style="white-space:nowrap">${esc(period)}</td>
          <td class="r item">${esc(rupees(charged))}</td>
        </tr>
        ${discount > 0 ? `<tr class="off">
          <td>Referral reward applied</td><td></td><td class="r">− ${esc(rupees(discount))}</td>
        </tr>` : ''}
        <tr class="total">
          <td>Amount received</td><td></td><td class="r">${esc(rupees(received))}</td>
        </tr>
      </tbody>
    </table>
    <div class="words">${esc(amountInWords(received))}</div>

    <div class="paidby">
      <div><div class="label">Paid by</div>${esc(payment.method || 'Cash')}</div>
      <div><div class="label">Received on</div>${esc(longDate(payment.payment_date))}</div>
      <div><div class="label">Receipt no.</div>${esc(receiptNo(payment))}</div>
    </div>

    ${due > 0
        ? `<div class="bal owing"><strong>${esc(rupees(due))} outstanding on this account as of ${esc(today)}.</strong>
             Entry by QR, fingerprint or card stays locked until the balance is cleared.</div>`
        : `<div class="bal clear">No dues outstanding on this account as of ${esc(today)}.</div>`}

    ${noteLines.length ? `<div class="note">${noteLines.map(l => `<p>${esc(l)}</p>`).join('')}</div>` : ''}

    ${footerHtml(brand, 'Computer-generated receipt — no signature required.')}`;

    return openPrintable(receiptNo(payment), html);
};
