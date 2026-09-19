// frontend/src/components/ui/printDoc.js
// The one printable document both the receipt and the invoice are built from.
//
// A member is handed both, often in the same visit, so they have to look like
// they came from the same gym: same masthead, same slogan, same money
// formatting, same small print, same paper. They were drifting apart because
// each was written where it was needed — and the invoice was not really a
// document at all. It called window.print() on the live app, which put the
// dialog's own Close and Print buttons on the paper, along with the page
// behind them, over two sheets.
//
// So printing opens a standalone window with only the document in it. The
// app's stylesheet has nothing to say about paper, and a print stylesheet that
// hides the whole UI except one dialog is a lot of CSS to get subtly wrong.

export const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const num = (v) => Number(v || 0);

export const rupees = (n) =>
    `₹${num(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const longDate = (d) => {
    if (!d) return '';
    const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
    if (isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

export const shortDate = (d) => {
    if (!d) return '';
    const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
    if (isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export const daysBetween = (from, to) => {
    if (!from || !to) return null;
    const a = new Date(`${String(from).slice(0, 10)}T00:00:00`);
    const b = new Date(`${String(to).slice(0, 10)}T00:00:00`);
    return isNaN(a.getTime()) || isNaN(b.getTime()) ? null : Math.round((b - a) / 86400000);
};

// ---- amount in words --------------------------------------------------------
// Indian numbering, because that is what a member here reads on every other
// document they are handed: thousand, lakh, crore — not million. A total
// spelled out is much harder to alter after the fact, which is the whole
// reason the convention exists.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const under1000 = (n) => {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
    return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${under1000(n % 100)}` : ''}`;
};

/** 912550.5 → "Rupees Nine Lakh Twelve Thousand Five Hundred Fifty and Fifty Paise only" */
export const amountInWords = (value) => {
    const total = Math.round(num(value) * 100);
    const whole = Math.floor(total / 100);
    const paise = total % 100;

    let rest = whole;
    const parts = [];
    for (const [size, label] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) {
        if (rest >= size) {
            parts.push(`${under1000(Math.floor(rest / size))} ${label}`);
            rest %= size;
        }
    }
    if (rest) parts.push(under1000(rest));

    const words = parts.join(' ').trim() || 'Zero';
    return `Rupees ${words}${paise ? ` and ${under1000(paise)} Paise` : ''} only`;
};

// ---- the paper --------------------------------------------------------------

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font: 13.5px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #0f172a; margin: 0; padding: 28px; background: #f8fafc; }
  .sheet { max-width: 680px; margin: 0 auto; background: #fff; padding: 34px 36px 28px;
           border-radius: 10px; box-shadow: 0 1px 3px rgba(15,23,42,.10); position: relative; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; }
  .gym { font-size: 21px; font-weight: 800; letter-spacing: -0.015em; }
  .slogan { font-size: 12px; font-style: italic; color: #059669; margin-top: 2px; }
  .muted { color: #64748b; font-size: 11.5px; }
  .title { text-align: right; white-space: nowrap; }
  .title h1 { font-size: 14px; margin: 0 0 5px; letter-spacing: 0.1em; text-transform: uppercase; }
  .no { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; font-weight: 700; }

  .parties { display: flex; justify-content: space-between; align-items: flex-start;
             gap: 24px; margin-top: 20px; }
  .label { font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
           color: #64748b; font-weight: 700; margin-bottom: 3px; }
  .who { font-size: 16px; font-weight: 700; }
  .stamp { border: 2.5px solid #059669; color: #059669; border-radius: 8px;
           padding: 6px 14px; font-weight: 800; letter-spacing: 0.14em; font-size: 15px;
           transform: rotate(-6deg); text-transform: uppercase; white-space: nowrap; }
  .stamp.due { border-color: #dc2626; color: #dc2626; }

  table { width: 100%; border-collapse: collapse; margin-top: 22px; }
  th, td { text-align: left; padding: 10px 0; vertical-align: top; }
  thead th { font-size: 10.5px; letter-spacing: 0.07em; text-transform: uppercase; color: #64748b;
             font-weight: 700; border-bottom: 1.5px solid #0f172a; padding-bottom: 7px; }
  tbody td { border-bottom: 1px solid #e2e8f0; }
  .r { text-align: right; white-space: nowrap; }
  .item { font-weight: 700; font-size: 14.5px; }
  .sub { color: #64748b; font-size: 12px; }
  .off td { color: #059669; font-weight: 600; }
  .sum td { border-bottom: none; padding: 4px 0; }
  .total td { border-bottom: none; border-top: 2px solid #0f172a; font-size: 17px;
              font-weight: 800; padding-top: 13px; }
  .words { margin-top: 6px; font-size: 12.5px; color: #334155; font-style: italic; }

  .paidby { margin-top: 18px; display: flex; gap: 34px; flex-wrap: wrap; }
  .bal { margin-top: 16px; padding: 11px 14px; border-radius: 6px; font-size: 12.5px; }
  .bal.clear { background: #f0fdf4; color: #14532d; }
  .bal.owing { background: #fef2f2; color: #7f1d1d; border-left: 3px solid #dc2626; }
  .note { margin-top: 16px; padding: 13px 16px; background: #f0fdf4;
          border-left: 3px solid #059669; border-radius: 0 6px 6px 0; font-size: 12.5px; }
  .note p { margin: 0 0 3px; }
  .note p:last-child { margin: 0; }
  .terms { margin-top: 18px; font-size: 11px; color: #64748b; }
  .sign { margin-top: 26px; display: flex; justify-content: flex-end; }
  .sign div { text-align: center; border-top: 1px solid #94a3b8; padding-top: 5px;
              min-width: 190px; font-size: 11px; color: #64748b; }
  .foot { margin-top: 22px; padding-top: 12px; border-top: 1px solid #e2e8f0;
          font-size: 10.5px; color: #94a3b8; display: flex; justify-content: space-between; gap: 16px; }
  @media print {
    body { padding: 0; background: #fff; }
    .sheet { box-shadow: none; border-radius: 0; padding: 0; max-width: none; }
    .noprint { display: none !important; }
  }
  .noprint { margin: 0 auto 18px; max-width: 680px; text-align: right; }
  .noprint button { font: inherit; padding: 9px 18px; border-radius: 8px; border: 0;
                    background: #059669; color: #fff; font-weight: 700; cursor: pointer; }
`;

/** The masthead every document shares: gym, slogan, address, contact, GSTIN. */
export const mastheadHtml = (brand, titleLine, reference, dateLine) => {
    const contact = [brand.phone, brand.email, brand.website].filter(Boolean).join('  ·  ');
    return `
    <div class="head">
      <div>
        <div class="gym">${esc(brand.name)}</div>
        ${brand.quote ? `<div class="slogan">${esc(brand.quote)}</div>` : ''}
        ${brand.address ? `<div class="muted">${esc(brand.address)}</div>` : ''}
        ${contact ? `<div class="muted">${esc(contact)}</div>` : ''}
        ${brand.gstin ? `<div class="muted">GSTIN: ${esc(brand.gstin)}</div>` : ''}
      </div>
      <div class="title">
        <h1>${esc(titleLine)}</h1>
        <div class="no">${esc(reference)}</div>
        <div class="muted">${esc(dateLine)}</div>
      </div>
    </div>`;
};

/** The small print and the vendor line, identical on both documents. */
export const footerHtml = (brand, closing) => `
    ${brand.receipt_note ? `<div class="terms">${esc(brand.receipt_note)}</div>` : ''}
    <div class="foot">
      <span>${esc(closing)}</span>
      ${brand.powered_by ? '<span>Powered by GYM OS</span>' : ''}
    </div>`;

/**
 * Opens the document in its own window.
 *
 * @returns false when the pop-up was blocked — the caller says so, because the
 *          person clicking did nothing wrong.
 */
export const openPrintable = (title, innerHtml) => {
    const win = window.open('', '_blank', 'width=820,height=960');
    if (!win) return false;
    win.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}</style></head>
<body>
  <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button></div>
  <div class="sheet">${innerHtml}</div>
</body></html>`);
    win.document.close();
    win.focus();
    return true;
};
