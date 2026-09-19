// frontend/src/components/ui/format.js
// Shared formatters. Every module renders money and dates the same way — these
// were previously re-declared (slightly differently) in each page.

/** ₹1,234.50 — the app is single-currency (INR). */
export const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '₹0.00';
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** ₹1,235 — compact form for stat tiles where decimals are noise. */
export const moneyShort = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '₹0';
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
};

/** 15 Aug 2026 — day-first, matching the dd/mm/yyyy date inputs. */
export const fmtDate = (d) => {
    if (!d) return '—';
    const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** 5 Sep 2026, 18:30 */
export const fmtDateTime = (d) => {
    if (!d) return '—';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    return `${fmtDate(d)}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Local YYYY-MM-DD for <input type="date"> (toISOString shifts the day in IST). */
export const todayStr = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/** Two-letter avatar initials. */
export const initialsOf = (name) =>
    (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

/**
 * ₹20.4L / ₹1.2Cr / ₹8,500 — for chart axes and tiles where the full number
 * would not fit. Uses lakh/crore because the rest of the app already groups in
 * the Indian system (₹40,78,000); a "₹2000k" axis next to that reads as a
 * different currency.
 */
export const moneyCompact = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '₹0';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : 1)}Cr`;
    if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
    if (a >= 1e3) return `${sign}₹${Math.round(a).toLocaleString('en-IN')}`;
    return `${sign}₹${Math.round(a)}`;
};

/** 1,234 / 12.3k — plain counts on a chart axis. */
export const countCompact = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return Math.abs(n) >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-IN');
};

/** '2026-08' → 'Aug 26'. Chart axes were showing the raw bucket key. */
export const fmtMonth = (key) => {
    if (!key) return '';
    const [y, m] = String(key).split('-');
    if (!y || !m) return String(key);
    const d = new Date(Number(y), Number(m) - 1, 1);
    if (isNaN(d.getTime())) return String(key);
    return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

/** 'Today' / 'Yesterday' / '5 Sep 2026' — relative where it helps, absolute otherwise. */
export const fmtDateFriendly = (d) => {
    if (!d) return '—';
    const date = new Date(String(d).length <= 10 ? `${d}T00:00:00` : d);
    if (isNaN(date.getTime())) return '—';
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(date) - startOf(new Date())) / 86400000);
    if (days === 0) return 'Today';
    if (days === -1) return 'Yesterday';
    if (days === 1) return 'Tomorrow';
    return fmtDate(d);
};

// ---- Title Case ------------------------------------------------------------
// The same rule the server applies on the way in (common/util/Names.java), run
// here on blur so the desk sees the value settle as they tab out of the field
// rather than being surprised by it after saving.
//
// Two things are deliberately left alone: anything with a digit in it (house
// numbers, "L-101", "3rd" — identifiers, not words) and short all-capital
// words ("MG Road", "DLF"), which are acronyms far more often than shouting.

const ACRONYM_MAX = 4;

const titleWord = (word) => {
    if (!word) return word;
    if (/\d/.test(word)) return word;
    if (word.length <= ACRONYM_MAX && word === word.toUpperCase() && /[a-z]/i.test(word)) return word;
    let out = '';
    let startOfWord = true;
    for (const c of word) {
        out += startOfWord ? c.toUpperCase() : c.toLowerCase();
        startOfWord = c === '-' || c === "'" || c === '.';
    }
    return out;
};

/** "gaurav SHARMA" → "Gaurav Sharma"; "12a, mg road" → "12a, MG Road". */
export const titleCase = (value) => {
    if (value == null) return value;
    const trimmed = String(value).trim().replace(/\s+/g, ' ');
    if (!trimmed) return trimmed;
    return trimmed.split(' ').map(titleWord).join(' ');
};

/**
 * onBlur for a text field that holds a name or an address.
 *
 *   <TextField name="name" value={form.name} onChange={handleChange}
 *              onBlur={titleCaseOnBlur(setForm)} />
 */
export const titleCaseOnBlur = (setForm) => (event) => {
    const { name, value } = event.target;
    if (!name) return;
    const tidy = titleCase(value);
    if (tidy !== value) setForm(f => ({ ...f, [name]: tidy }));
};
