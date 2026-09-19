// frontend/src/components/ui/useExceptions.js
// DB-driven form validation, shared by every module.
//
// The `exceptions` master table holds one row per form field per module:
// an E-code, the label, whether it is mandatory, and the allowed character set.
// MembersPage pioneered this; this hook packages the same behaviour so every
// module validates identically and renders alerts as "[E-code] MESSAGE."
//
// Usage:
//   const { rules, validate, fieldError, liveCheck } = useExceptions('lockers', FALLBACK);
//   const errors = validate(form);          // { field: '[E1601] NUMBER IS MANDATORY.' }
//   <TextField error={!!errors.number} …/>

import { useEffect, useState, useCallback } from 'react';
import api from '../../api';
import { patternError, isEmpty } from '../../validation';

/**
 * @param {string} moduleName  the `module` column value, e.g. 'lockers'
 * @param {Array}  fallback    rules to use before the fetch resolves / on failure.
 *                             Same shape as the API rows.
 */
export const useExceptions = (moduleName, fallback = []) => {
    const [rules, setRules] = useState(fallback);

    useEffect(() => {
        let alive = true;
        api.get(`/exceptions?module=${encodeURIComponent(moduleName)}`)
            .then(res => { if (alive && Array.isArray(res.data) && res.data.length) setRules(res.data); })
            .catch(() => { /* keep the fallback — validation still works offline */ });
        return () => { alive = false; };
    }, [moduleName]);

    const ruleFor = useCallback((field) => rules.find(r => r.field_name === field), [rules]);

    /** Format one rule violation the way every module's alerts read. */
    const msg = (rule, text) => `[${rule.code || 'E000'}] ${text}.`;

    /**
     * Validate a whole form object.
     * @param {object} form
     * @param {object} opts  { skip: ['trainer_id'] } to ignore fields this
     *                       form doesn't show (e.g. admin-only inputs).
     */
    const validate = useCallback((form, opts = {}) => {
        const skip = new Set(opts.skip || []);
        const errors = {};
        rules.forEach(rule => {
            if (skip.has(rule.field_name)) return;
            const value = form[rule.field_name];
            if (rule.is_mandatory && isEmpty(value)) {
                errors[rule.field_name] = msg(rule, rule.message || `${rule.field_label.toUpperCase()} IS MANDATORY`);
                return;
            }
            if (rule.allowed_chars && !isEmpty(value) && patternError(String(value).trim(), rule.allowed_chars)) {
                errors[rule.field_name] = msg(rule, rule.format_message || 'INVALID VALUE');
            }
        });
        return errors;
    }, [rules]);

    /**
     * Live format check for a single field as the user types — the same alert
     * text the submit-time check produces, so the message never changes shape.
     */
    const liveCheck = useCallback((field, value) => {
        const rule = ruleFor(field);
        if (!rule || !rule.allowed_chars || isEmpty(value)) return null;
        return patternError(String(value).trim(), rule.allowed_chars)
            ? msg(rule, rule.format_message || 'INVALID VALUE')
            : null;
    }, [ruleFor]);

    /** Is this field mandatory per the master table? (drives the `required` prop) */
    const isRequired = useCallback((field) => !!ruleFor(field)?.is_mandatory, [ruleFor]);

    return { rules, ruleFor, validate, liveCheck, isRequired };
};

export default useExceptions;
