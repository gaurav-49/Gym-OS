// frontend/src/validation.js
// Shared input-format validation used across all modules. The rules mirror the
// field_rules master table (allowed_chars) so every form behaves the same way:
// a field that must be numeric shows "Number only allowed" the moment the user
// types something else — instead of silently dropping characters.

/**
 * Validate a value against an allowed-character set.
 * @param {string} value   trimmed input value
 * @param {string} allowed 'numeric' | 'alpha' | 'alphanumeric' | null (any)
 * @returns {string|null} the error message to show, or null when valid
 */
export const patternError = (value, allowed) => {
    if (!allowed || value === undefined || value === null) return null;
    const v = String(value);
    if (!v) return null; // blank values are handled by the mandatory check
    if (allowed === 'numeric') return /^\d+$/.test(v) ? null : 'Number only allowed';
    if (allowed === 'alpha') return /^[A-Za-z ]+$/.test(v) ? null : 'Alphabets only allowed';
    if (allowed === 'alphanumeric') return /^[A-Za-z0-9 ]+$/.test(v) ? null : 'Letters and numbers only allowed';
    return null;
};

/** True when a value is blank (used for mandatory checks). */
export const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '';
