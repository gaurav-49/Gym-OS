// frontend/src/components/ui/invoice.js
// One invoice, as a document that can go to a member or an accountant.
//
// Built on the same paper as the receipt (printDoc.js) so the two match: same
// masthead, same slogan, same money formatting, same small print.
//
// It used to be printed by calling window.print() on the live app, which put
// the dialog's own Close and Print buttons on the page along with everything
// behind them, over two sheets. Nothing about that was a document.

import {
    amountInWords, esc, footerHtml, longDate, mastheadHtml, openPrintable, rupees,
} from './printDoc';

const num = (v) => Number(v || 0);

/** Whether this invoice has been settled — the stamp and the balance line. */
const settled = (invoice) => String(invoice.status || '').toLowerCase() === 'paid';

/**
 * @param invoice one invoice with its `items`
 * @param brand   useBranding() output — the gym's own identity, never "GYM OS"
 * @returns false if the pop-up was blocked; the caller shows the fallback
 */
export const printInvoice = (invoice, brand) => {
    const items = invoice.items || [];
    const total = num(invoice.total);
    const paid = settled(invoice);

    // A tax invoice states the gym that raised it. A branch, where a chain uses
    // them, is the address on it — not a different business.
    const issuer = {
        ...brand,
        address: invoice.branch_address || brand.address,
        gstin: invoice.branch_gst || brand.gstin,
    };

    const rows = items.map(it => `
        <tr>
          <td>
            <div class="item">${esc(it.description)}</div>
            ${it.hsn_sac ? `<div class="sub">HSN/SAC ${esc(it.hsn_sac)}</div>` : ''}
          </td>
          <td class="r">${esc(Number(it.quantity))}</td>
          <td class="r">${esc(rupees(it.unit_price))}</td>
          <td class="r">${esc(Number(it.tax_rate))}%</td>
          <td class="r item">${esc(rupees(it.line_total))}</td>
        </tr>`).join('');

    const html = `
    ${mastheadHtml(issuer, 'Tax invoice', invoice.invoice_no, longDate(invoice.invoice_date))}

    <div class="parties">
      <div>
        <div class="label">Billed to</div>
        <div class="who">${esc(invoice.customer_name)}</div>
        ${invoice.member_code
        ? `<div class="muted">Member ID ${esc(invoice.member_code)}${
            invoice.member_phone ? `  ·  ${esc(invoice.member_phone)}` : ''}</div>`
        : ''}
        ${invoice.branch_name ? `<div class="muted">Issued at ${esc(invoice.branch_name)}</div>` : ''}
      </div>
      <div class="stamp${paid ? '' : ' due'}">${paid ? 'Paid' : 'Unpaid'}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="r">Qty</th>
          <th class="r">Rate</th>
          <th class="r">Tax</th>
          <th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5" class="sub">No line items.</td></tr>'}
        <tr class="sum">
          <td colspan="4" class="r sub">Subtotal</td>
          <td class="r">${esc(rupees(invoice.subtotal))}</td>
        </tr>
        <tr class="sum">
          <td colspan="4" class="r sub">Tax</td>
          <td class="r">${esc(rupees(invoice.tax_amount))}</td>
        </tr>
        <tr class="total">
          <td colspan="4">Total</td>
          <td class="r">${esc(rupees(total))}</td>
        </tr>
      </tbody>
    </table>
    <div class="words">${esc(amountInWords(total))}</div>

    <div class="paidby">
      <div><div class="label">Invoice no.</div>${esc(invoice.invoice_no)}</div>
      <div><div class="label">Date</div>${esc(longDate(invoice.invoice_date))}</div>
      ${paid && invoice.method
        ? `<div><div class="label">Paid by</div>${esc(invoice.method)}</div>` : ''}
    </div>

    ${paid
        ? `<div class="bal clear">Settled in full — nothing outstanding on this invoice.</div>`
        : `<div class="bal owing"><strong>${esc(rupees(total))} due.</strong>
             Please settle at the front desk to keep the membership active.</div>`}

    ${invoice.notes ? `<div class="note"><p>${esc(invoice.notes)}</p></div>` : ''}

    <div class="sign"><div>Authorised signatory</div></div>

    ${footerHtml(issuer, 'This is a computer-generated tax invoice.')}`;

    return openPrintable(invoice.invoice_no || 'Invoice', html);
};
