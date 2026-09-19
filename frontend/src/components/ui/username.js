// frontend/src/components/ui/username.js
// What a staff username may contain, and how a username field behaves.
//
// Three rules, the first two mirrored on the server in
// common/security/Usernames.java:
//   * letters, numbers, dots and underscores only
//   * case is not part of the identity — MUNNA and munna are one account
//   * folded to upper case when the field is left, never mid-keystroke
//
// The case rule matters because a phone keyboard capitalises the first letter
// of a text field by default, so a trainer signing in from the gym floor typed
// "Munna" for an account stored as "munna" and the login failed with no
// visible cause. Since case cannot break a login any more, displaying it in
// upper case is free — the server folds it back to the canonical form before
// it looks anything up or stores it.
//
// It is NOT free to do it on every keystroke, which is what this file used to
// do. Type "admin" and the field answers "ADMIN", and the only explanation a
// person has for that is Caps Lock. They then type a password they believe is
// being capitalised too — and the password IS case-sensitive, so the login
// fails for a reason the screen never showed them. The fold now happens on
// blur, once, when the field is done.
//
// Passwords are the exact opposite and are never transformed: case is most of
// the entropy a short password has.

/** Everything a username field should carry. */
export const usernameInputProps = {
    // 'off', not 'characters'. A keyboard that shouts every letter back tells
    // the same lie the old onChange told; case is folded on blur instead, and
    // the server does not care either way.
    autoCapitalize: 'off',
    autoCorrect: 'off',
    autoComplete: 'username',
    spellCheck: false,
    inputMode: 'text',
    maxLength: 50,
};

/**
 * What the field shows WHILE it is being typed: the characters a username may
 * contain, in whatever case the person used. Nothing is transformed here, so
 * what they see is what they pressed.
 */
export const typedUsername = (raw) =>
    String(raw || '').replace(/[^A-Za-z0-9._]/g, '');

/** Fold what was typed into the canonical form. Call on blur and on submit. */
export const normaliseUsername = (raw) =>
    String(raw || '').toUpperCase().replace(/[^A-Z0-9._]/g, '');

/** @returns an error string to show, or '' when the username is fine */
export const usernameError = (value) => {
    const u = normaliseUsername(value);
    if (!u) return 'A username is required.';
    if (u.length < 3) return 'A username must be at least 3 characters.';
    if (!/^[A-Z0-9](?:[A-Z0-9._]*[A-Z0-9])?$/.test(u)) {
        return 'A username must start and end with a letter or number.';
    }
    return '';
};

/** How a stored username is shown anywhere it is displayed back. */
export const displayUsername = (raw) => String(raw || '').toUpperCase();
