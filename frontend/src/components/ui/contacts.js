// frontend/src/components/ui/contacts.js
// Phone and email rules, mirroring common/util/Contacts.java on the server.
//
// Duplicated deliberately: the server is the authority (a client can always be
// bypassed), but a member standing at the desk should be told their number is
// nine digits before the form is submitted, not after. Both sides must say the
// same thing, so the messages here are the server's messages verbatim.

const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 15;
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const PHONE_SHAPE = /^[0-9+()\-\s]+$/;

/** @returns the message to show, or '' when the number is usable */
export const phoneError = (raw, required = false) => {
    const value = String(raw ?? '').trim();
    if (!value) return required ? 'A phone number is required.' : '';
    if (!PHONE_SHAPE.test(value)) {
        return 'A phone number can only contain digits, and + ( ) - or spaces.';
    }
    const digits = value.replace(/\D/g, '').length;
    if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) {
        return `A phone number must be between ${MIN_PHONE_DIGITS} and ${MAX_PHONE_DIGITS} digits.`;
    }
    return '';
};

/** @returns the message to show, or ''. A blank email is always fine. */
export const emailError = (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return '';
    return EMAIL.test(value) ? '' : `"${value}" is not a valid email address.`;
};

/** Local YYYY-MM-DD. toISOString() would shift the day backwards in IST. */
export const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
