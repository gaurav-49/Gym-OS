// frontend/src/components/MembersPage.jsx

import React, { useEffect, useRef, useState } from 'react';
import api from '../api';
import {
    patternError, isEmpty } from '../validation';
import { log, logError } from '../logger';
import {
    Paper, Typography, TextField, Button, Card, CardContent, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem, Alert, Chip, IconButton, GridLegacy as Grid, Box, Tabs, Tab, Avatar, Divider, InputAdornment, Stack, Switch, FormControlLabel, Menu, Radio, RadioGroup, Tooltip
, Skeleton} from '@mui/material';
import Alerts from './Alerts';
import { phoneError, emailError, todayISO } from './ui/contacts';
import {
    Add, Delete, Restore, Refresh, Visibility, Search, Phone, Badge, Person, SwapHoriz, MoreVert, AcUnit, Upgrade, Block, PlayCircleOutline, Groups, DeleteForever, Fingerprint, Lock, CardGiftcard, Payments, Autorenew,
} from '@mui/icons-material';
import MemberPaymentsTab from './memberTabs/MemberPaymentsTab.jsx';
import MemberWorkoutTab from './memberTabs/MemberWorkoutTab.jsx';
import MemberDietTab from './memberTabs/MemberDietTab.jsx';
import MemberProgressTab from './memberTabs/MemberProgressTab.jsx';

import { PAYMENT_MODES } from '../constants';
import { usePlans, useConfirm, fmtDate, useToast, titleCaseOnBlur } from './ui';
import EmptyState from './ui/EmptyState';

const PAGE_SIZE = 60; // member cards rendered before the "show more" button
const GENDERS = ['Male', 'Female', 'Other'];

// The Details tab's mandatory fields. Amount Due is auto-computed from
// fee − paid, so it isn't user-entered and has no message.
//
// Email and Trainer are deliberately NOT here. A walk-in often has no email
// address, and demanding one only taught the desk to invent them; assigning a
// trainer is a decision the gym makes later, not a condition of joining —
// nearly every existing member has none. Both are still validated for shape
// when filled in; they are simply allowed to be blank.
const MANDATORY_FIELDS = [
    { name: 'member_code', label: 'Member ID' },
    { name: 'name', label: 'Full Name' },
    { name: 'phone', label: 'Phone' },
    { name: 'gender', label: 'Gender' },
    { name: 'join_date', label: 'Join Date' },
    { name: 'membership_type', label: 'Membership Type' },
    { name: 'status', label: 'Status' },
    { name: 'membership_start', label: 'Membership Start' },
    { name: 'membership_expiry', label: 'Membership Expiry' },
    { name: 'membership_fee', label: 'Membership Fee' },
    { name: 'amount_paid', label: 'Amount Paid' },
    { name: 'payment_mode', label: 'Mode of Payment' },
];
// Trainer only renders for admins, and is optional there too.

// The order the fields appear on the Details tab. The summary alert lists the
// errors in this order so the reader's eye travels down the form the same way
// twice; Object.entries order is insertion order, which is whichever field the
// desk happened to touch first.
const FIELD_ORDER = [
    'member_code', 'name', 'phone', 'email', 'gender', 'join_date', 'dob', 'address',
    'membership_type', 'status', 'membership_start', 'membership_expiry',
    'custom_duration_days', 'trainer_id',
    'card_uid', 'locker_number', 'locker_amount', 'locker_until', 'referral_code',
    'membership_fee', 'amount_paid', 'payment_mode', 'recurring_method',
];
const fieldRank = (name) => {
    const i = FIELD_ORDER.indexOf(name);
    return i === -1 ? FIELD_ORDER.length : i;   // unknown fields sort last, not first
};

/**
 * One block of the member form.
 *
 * Every section used to build its own heading out of a Divider and a
 * Typography, which drifted: different gaps above and below, different weights,
 * an "(optional)" on some and not others. One component, one look.
 */
const Section = ({ icon: Icon, title, hint, first, children }) => (
    <Box sx={{ mt: first ? 0 : 3 }}>
        <Box display="flex" alignItems="baseline" gap={1} mb={1.5}>
            {Icon && <Icon fontSize="small" sx={{ color: 'primary.main', alignSelf: 'center' }} />}
            <Typography variant="subtitle2" color="primary" fontWeight={700}>{title}</Typography>
            {hint && (
                <Typography variant="caption" color="text.secondary">{hint}</Typography>
            )}
        </Box>
        {children}
    </Box>
);

/**
 * A switch that lines up with the text fields beside it.
 *
 * A bare Switch is half the height of a TextField, so a row with one on the
 * left and a field on the right sat visibly crooked. Boxing it gives the row
 * two blocks of the same height and the same edges.
 */
const ToggleField = ({ checked, onChange, label, hint, children }) => (
    <Box sx={{
        border: '1px solid', borderColor: checked ? 'primary.main' : 'divider',
        bgcolor: checked ? 'action.hover' : 'transparent',
        borderRadius: 1.5, px: 1.5, py: 1, minHeight: 56,
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        transition: 'border-color .15s, background-color .15s',
    }}>
        <FormControlLabel
            sx={{ m: 0 }}
            control={<Switch size="small" checked={checked} onChange={onChange} />}
            label={<Typography variant="body2" fontWeight={600}>{label}</Typography>}
        />
        {hint && (
            <Typography variant="caption" color="text.secondary" sx={{ pl: 5.5, mt: -0.25 }}>
                {hint}
            </Typography>
        )}
        {children}
    </Box>
);

// Placeholder for Payments/Workout/Diet/Progress while adding a brand-new
// member — those tabs load/save per-member records and need a saved member.
const NotSavedTab = ({ title, description }) => (
    <Box sx={{ py: 4, textAlign: 'center' }}>
        <Typography variant="h6" gutterBottom>{title}</Typography>
        <Typography variant="body2" color="text.secondary">{description}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Complete the Details tab and click “Add Member” to save — then manage {title.toLowerCase()} here.
        </Typography>
    </Box>
);

// Days added to the start date to auto-fill the expiry for each plan.
const MEMBERSHIP_DURATION_DAYS = { Monthly: 30, Quarterly: 90, 'Half-Yearly': 180, Yearly: 365, Custom: null };

// YYYY-MM-DD + days -> YYYY-MM-DD (local time, no UTC shift)
const computeExpiry = (start, type, customDays) => {
    if (!start) return '';
    const days = type === 'Custom' ? (Number(customDays) || 0) : (MEMBERSHIP_DURATION_DAYS[type] || 0);
    if (!days) return '';
    const d = new Date(`${start}T00:00:00`);
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'expiring', label: 'Expiring' },
    { id: 'expired', label: 'Expired' },
];

const emptyForm = {
    member_code: '', name: '', phone: '', email: '', address: '', gender: '',
    dob: '', join_date: '', membership_type: 'Monthly',
    membership_start: '', membership_expiry: '', status: 'active', trainer_id: '',
    custom_duration_days: 30,
    membership_fee: '', amount_paid: '', amount_due: '', payment_mode: 'Cash',
    auto_renew: false, recurring_method: '',
    // Gate credentials (fingerprint + RFID card)
    card_uid: '', activate_fingerprint: false, fingerprint_status_display: '',
    // Locker, if they take one at the desk. Off by default, like fingerprint.
    assign_locker: false, locker_number: '', locker_amount: '', locker_until: '',
    // Whoever's code brought them in. Not to be confused with the member's own
    // code, which the server assigns on save.
    referral_code: '',
};

const expiryChip = (status) => {
    const map = {
        ok: { label: 'Valid', color: 'success' },
        expiring: { label: 'Expiring', color: 'warning' },
        expired: { label: 'Expired', color: 'error' },
    };
    return map[status] || { label: '—', color: 'default' };
};

const avatarStyle = (m) => {
    if (m.status !== 'active') return { bgcolor: 'action.hover', color: 'text.secondary' };
    if (m.expiry_status === 'expired') return { bgcolor: 'error.softBg', color: 'error.dark' };
    if (m.expiry_status === 'expiring') return { bgcolor: 'warning.softBg', color: 'warning.dark' };
    return { bgcolor: 'success.softBg', color: 'success.dark' };
};

const initialsOf = (name) => (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();


const MembersPage = ({ isAdmin, onboardLead, onLeadOnboarded }) => {
    const toast = useToast();
    const [members, setMembers] = useState([]);
    // Distinguishes "still loading" from "genuinely empty" — without it the
    // table showed its empty state on every page load.
    const [loading, setLoading] = useState(true);
    const [trainers, setTrainers] = useState([]);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [visibleCount, setVisibleCount] = useState(60);
    // The gym's own packages, so a custom plan is sellable from this form.
    const { planNames } = usePlans();
    // A lead handed over from the Leads page opens this form pre-filled. The
    // ref stops it reopening every time the list refreshes underneath.
    const onboardingRef = useRef(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailTab, setDetailTab] = useState(0);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(emptyForm);
    const [formErrors, setFormErrors] = useState({});
    // Validation rules loaded from the field_rules master table (members module).
    // Falls back to the built-in MANDATORY_FIELDS list if the API is unavailable.
    const [fieldRules, setFieldRules] = useState([]);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    // Renumber ID dialog state
    const [renumberOpen, setRenumberOpen] = useState(false);
    const [renumberMember, setRenumberMember] = useState(null);
    const [renumberCode, setRenumberCode] = useState('');
    const [renumberCount, setRenumberCount] = useState(0);
    const [renumberError, setRenumberError] = useState('');
    const [renumberBusy, setRenumberBusy] = useState(false);
    // Renew dialog state
    const [renewOpen, setRenewOpen] = useState(false);
    const [renewMember, setRenewMember] = useState(null);
    const [renewForm, setRenewForm] = useState({ membership_type: '', membership_fee: '', amount_paid: '', payment_mode: 'Cash' });
    const [renewError, setRenewError] = useState('');
    const [renewBusy, setRenewBusy] = useState(false);
    // Lifecycle menu + dialogs (freeze / resume / upgrade / cancel)
    const [menuAnchor, setMenuAnchor] = useState(null);
    const [menuMember, setMenuMember] = useState(null);
    const [freezeOpen, setFreezeOpen] = useState(false);
    const [freezeMember, setFreezeMember] = useState(null);
    const [freezeForm, setFreezeForm] = useState({ days: 14, reason: '' });
    const [freezeError, setFreezeError] = useState('');
    const [freezeBusy, setFreezeBusy] = useState(false);
    const [upgradeOpen, setUpgradeOpen] = useState(false);
    const [upgradeMember, setUpgradeMember] = useState(null);
    const [upgradeForm, setUpgradeForm] = useState({ membership_type: 'Quarterly', amount: '', method: 'Cash' });
    const [upgradeError, setUpgradeError] = useState('');
    const [upgradeBusy, setUpgradeBusy] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const [cancelMember, setCancelMember] = useState(null);
    const [cancelEffective, setCancelEffective] = useState('now');
    const [cancelError, setCancelError] = useState('');
    const [cancelBusy, setCancelBusy] = useState(false);

    const fetchMembers = async () => {
        try {
            const res = await api.get('/clients');
            setMembers(res.data);
            setLoadError('');
        } catch (err) {
            console.error('Error fetching members:', err);
            setLoadError(err.response?.data?.error || 'Failed to load members.');
        } finally { setLoading(false); }
    };

    const fetchTrainers = async () => {
        try {
            const res = await api.get('/users');
            setTrainers(res.data.filter(u => u.role === 'trainer'));
        } catch (err) {
            // Trainers can't list users — that's fine, no trainer dropdown for them.
            setTrainers([]);
        }
    };

    useEffect(() => {
        fetchMembers();
        if (isAdmin) fetchTrainers();
    }, []);

    // Load the field validation rules master table for this module.
    useEffect(() => {
        api.get('/exceptions?module=members')
            .then(res => { if (Array.isArray(res.data) && res.data.length) setFieldRules(res.data); })
            .catch(err => console.error('[MembersPage] exceptions load failed (using built-in rules):', err?.response?.data || err?.message));
    }, []);

    /**
     * @param lead  a lead being converted, or null for a walk-in
     *
     * A lead carries only what somebody wrote on the enquiry — a name, usually
     * a phone. Converting used to create the member from exactly that, so a
     * member arrived with no address, no date of birth and no fee, none of
     * which the onboarding form would have let through. Now the lead opens
     * this form pre-filled and every rule applies as it does to anyone else.
     */
    const openCreate = (lead = null) => {
        const now = new Date();
        const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const plan = MEMBERSHIP_DURATION_DAYS[lead?.interest] ? lead.interest : 'Monthly';
        setEditing(null);
        setForm({
            ...emptyForm,
            member_code: '',
            name: lead?.name || '',
            phone: lead?.phone || '',
            email: lead?.email || '',
            membership_type: plan,
            join_date: todayLocal,
            membership_start: todayLocal,
            membership_expiry: computeExpiry(todayLocal, plan),
        });
        setFormErrors({});
        toast.success('');
        setError('');
        setDetailOpen(true);
        setDetailTab(0);
        // Member IDs run in sequence, so the desk should never have to invent
        // one. The server is the only place that can see every member and
        // every number given back by a deletion — this list is one page of
        // many, so the highest code on it is not the highest code there is.
        api.get('/clients/next-code')
            .then(res => setForm(f => (f.member_code ? f : { ...f, member_code: res.data.member_code })))
            .catch(() => { /* the desk can type one; the form will not save without it */ });
    };

    useEffect(() => {
        if (!onboardLead || onboardingRef.current === onboardLead.id) return;
        onboardingRef.current = onboardLead.id;
        openCreate(onboardLead);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onboardLead]);

    const openDetail = (member) => {
        setEditing(member);
        setForm({
            member_code: member.member_code || '', name: member.name || '', phone: member.phone || '',
            email: member.email || '', address: member.address || '', gender: member.gender || '', dob: member.dob || '',
            join_date: member.join_date || '', membership_type: member.membership_type || 'Monthly',
            membership_start: member.membership_start || '', membership_expiry: member.membership_expiry || '',
            status: member.status || 'active', trainer_id: member.trainer_id ? String(member.trainer_id) : '',
            membership_fee: member.membership_fee != null ? String(member.membership_fee) : '',
            amount_paid: member.amount_paid != null ? String(member.amount_paid) : '',
            // Amount Due is auto-computed everywhere (fee − paid) — never typed.
            amount_due: String(Math.max(0, (Number(member.membership_fee) || 0) - (Number(member.amount_paid) || 0))),
            custom_duration_days: 30,
            auto_renew: member.auto_renew === true, recurring_method: member.recurring_method || '',
            card_uid: member.card_uid || '',
            activate_fingerprint: (member.fingerprint_status || 'not_enrolled') !== 'not_enrolled',
            fingerprint_status_display: member.fingerprint_status === 'enrolled'
                ? 'Fingerprint enrolled'
                : member.fingerprint_status === 'pending'
                    ? 'Fingerprint pending — scan at machine'
                    : '',
            // Filled in below from /clients/{id}, the only call that knows
            // about the locker: one taken from the Lockers page has to show up
            // here too, or the two screens tell different stories.
            assign_locker: false, locker_number: '', locker_amount: '', locker_until: '',
        });
        api.get(`/clients/${member.id}`)
            .then(res => {
                const locker = res.data.locker;
                if (!locker) return;
                setForm(f => ({
                    ...f,
                    assign_locker: true,
                    locker_number: locker.locker_number || '',
                    locker_amount: locker.monthly_rent != null ? String(locker.monthly_rent) : '',
                    locker_until: locker.assigned_until ? String(locker.assigned_until).slice(0, 10) : '',
                }));
            })
            .catch(() => { /* the rest of the form is already usable */ });
        setFormErrors({});
        toast.success('');
        setError('');
        setDetailOpen(true);
        setDetailTab(0);
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        // Card UIDs are alphanumeric (RFID hex/decimal) — strip anything else.
        const clean = name === 'card_uid' || name === 'referral_code'
            ? value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
            : value;
        const next = { ...form, [name]: clean };
        // Auto-fill the expiry whenever the start date, plan, or custom duration changes.
        if (name === 'membership_start' || name === 'membership_type' || name === 'custom_duration_days') {
            next.membership_expiry = computeExpiry(
                name === 'membership_start' ? value : form.membership_start,
                name === 'membership_type' ? value : form.membership_type,
                name === 'custom_duration_days' ? value : (form.custom_duration_days || 30)
            );
        }
        // Joining today usually means the membership starts today too.
        if (name === 'join_date' && !next.membership_start) {
            next.membership_start = value;
            next.membership_expiry = computeExpiry(value, next.membership_type, next.custom_duration_days || 30);
        }
        // Amount Due is ALWAYS auto-computed as fee − paid — never typed by hand.
        if (name === 'membership_fee' || name === 'amount_paid') {
            next.amount_due = String(Math.max(0, (Number(next.membership_fee) || 0) - (Number(next.amount_paid) || 0)));
        }
        // Clear the validation error for this field as soon as it's edited, then
        // re-apply a live format check (e.g. "Number only allowed") for fields
        // that accept only numbers/alphabets per the field_rules master table.
        let nextErrors = formErrors;
        if (formErrors[name]) {
            const cleared = { ...formErrors };
            delete cleared[name];
            nextErrors = cleared;
        }
        // Live format check: the alert is keyed to the exceptions master table
        // so it reads "[E-code] MESSAGE." exactly like the submit-time alerts.
        const rule = fieldRules.find(r => r.field_name === name);
        if (rule && rule.allowed_chars && patternError(next[name], rule.allowed_chars)) {
            nextErrors = { ...nextErrors, [name]: `[${rule.code}] ${rule.format_message || 'INVALID VALUE'}.` };
        }
        setFormErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) setError('');
        setForm(next);
    };

    // Mandatory + format rules for this form. Driven by the exceptions master
    // table when available; otherwise the built-in list (trainer is mandatory
    // only for admins, who are the only ones who see the field).
    const mandatoryFields = () => {
        // The exceptions master table decides this; MANDATORY_FIELDS is only the
        // fallback for when it cannot be read. Trainer used to need a special
        // case here — mandatory, but only once the gym had a trainer account,
        // or a fresh install could not create its first member. It is optional
        // now, so the rule is simply whatever the table says.
        if (fieldRules.length) {
            return fieldRules
                .filter(r => r.is_mandatory)
                .map(r => ({
                    name: r.field_name, label: r.field_label, allowed_chars: r.allowed_chars,
                    code: r.code, message: r.message, format_message: r.format_message
                }));
        }
        return MANDATORY_FIELDS.map(f => ({
            name: f.name, label: f.label, allowed_chars: f.name === 'member_code' ? 'numeric' : null,
            code: 'E000', message: `${f.label.toUpperCase()} IS MANDATORY`, format_message: 'NUMBER ONLY ALLOWED'
        }));
    };

    // The form's field errors as a plain list, in the order the fields appear
    // rather than whatever order the object happens to hold them in.
    const formErrorList = Object.entries(formErrors)
        .sort(([a], [b]) => fieldRank(a) - fieldRank(b))
        .map(([, msg]) => msg);

    const validateForm = () => {
        const errors = {};
        mandatoryFields().forEach(f => {
            const v = form[f.name];
            if (isEmpty(v)) {
                errors[f.name] = `[${f.code}] ${f.message}.`;
                return;
            }
            // Format guard (number/alpha only) for fields that require it.
            if (f.allowed_chars) {
                const msg = patternError(String(v).trim(), f.allowed_chars);
                if (msg) errors[f.name] = `[${f.code}] ${f.format_message || 'INVALID VALUE'}.`;
            }
        });

        // Beyond "is it blank": the shapes that used to pass the form and get
        // rejected only by the server, or worse, saved as nonsense. Mirrors
        // MemberServiceImpl so the answer is the same either way, and arrives
        // without a round trip.
        const phoneMsg = phoneError(form.phone, true);
        if (!errors.phone && phoneMsg) errors.phone = phoneMsg;

        const emailMsg = emailError(form.email);
        if (!errors.email && emailMsg) errors.email = emailMsg;

        if (form.name && String(form.name).trim().length === 1) {
            errors.name = "Enter the member's full name — a single letter is not one.";
        }
        if (form.dob && String(form.dob) > todayISO()) {
            errors.dob = 'The date of birth cannot be in the future.';
        }
        if (form.membership_start && form.membership_expiry
            && String(form.membership_expiry) < String(form.membership_start)) {
            errors.membership_expiry = 'The membership cannot expire before it starts.';
        }
        const fee = Number(form.membership_fee);
        const paid = Number(form.amount_paid);
        if (form.membership_fee !== '' && form.amount_paid !== ''
            && !isNaN(fee) && !isNaN(paid) && paid > fee) {
            errors.amount_paid = `Amount paid (₹${paid}) is more than the fee (₹${fee}).`
                + ' Record the extra as a separate payment if it is an advance.';
        }
        // A locker being assigned needs the number on the wall; the charge is
        // optional, but if it is typed it has to be money.
        if (form.assign_locker) {
            if (!String(form.locker_number || '').trim()) {
                errors.locker_number = 'LOCKER NUMBER IS MANDATORY';
            }
            if (form.locker_amount !== '' && form.locker_amount != null
                && (isNaN(Number(form.locker_amount)) || Number(form.locker_amount) < 0)) {
                errors.locker_amount = 'LOCKER CHARGE MUST BE A NUMBER';
            }
        }
        return errors;
    };

    const handleSave = async () => {
        // Mandatory-field validation (everything except the auto-renew toggle and
        // the recurring method). Every missing/invalid field gets a red boundary
        // AND its own alert rendered above the form — one alert per field.
        const errors = validateForm();
        setFormErrors(errors);
        if (Object.keys(errors).length > 0) {
            log('MembersPage', 'handleSave', `→ validation blocked (${Object.keys(errors).length} errors): ${Object.keys(errors).join(', ')}`);
            setError('');
            return;
        }
        log('MembersPage', 'handleSave', `→ ${editing ? 'update' : 'create'} member code=${form.member_code} name="${form.name}" plan=${form.membership_type}`);
        try {
            if (editing) {
                await api.put(`/clients/${editing.id}`, form);
                toast.success('Member updated successfully.');
            } else {
                const created = await api.post('/clients', form);
                // Converting a lead is finished by linking it to the member the
                // form just created — the lead stops being an open enquiry, and
                // the member exists with every field onboarding asks for.
                if (onboardLead) {
                    await api.post(`/leads/${onboardLead.id}/convert`, { member_id: created.data.id });
                    toast.success(`${form.name} onboarded — the lead is marked converted.`);
                    onboardingRef.current = null;
                    if (onLeadOnboarded) onLeadOnboarded();
                } else {
                    toast.success('Member added successfully.');
                }
                setDetailOpen(false);
            }
            setError('');
            log('MembersPage', 'handleSave', `← member saved (${editing ? 'updated' : 'created'}) code=${form.member_code}`);
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleSave', `✗ save failed for member code=${form?.member_code}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to save member.');
        }
    };

    const openRenew = (member) => {
        setRenewMember(member);
        setRenewForm({
            membership_type: member.membership_type || 'Monthly',
            membership_fee: member.membership_fee !== null && member.membership_fee !== undefined ? String(member.membership_fee) : '',
            amount_paid: '',
            payment_mode: member.payment_mode || 'Cash',
        });
        setRenewError('');
        setRenewOpen(true);
    };

    const renewDue = Math.max(0, (Number(renewForm.membership_fee) || 0) - (Number(renewForm.amount_paid) || 0));

    const handleRenewSubmit = async () => {
        if (renewForm.membership_fee !== '' && (Number(renewForm.membership_fee) < 0 || isNaN(Number(renewForm.membership_fee)))) {
            setRenewError('Renewal fee must be a non-negative number.');
            return;
        }
        if (renewForm.amount_paid !== '' && (Number(renewForm.amount_paid) < 0 || isNaN(Number(renewForm.amount_paid)))) {
            setRenewError('Amount paid must be a non-negative number.');
            return;
        }
        setRenewBusy(true);
        setRenewError('');
        log('MembersPage', 'handleRenewSubmit', `→ renew member id=${renewMember.id} code=${renewMember.member_code} plan=${renewForm.membership_type} fee=${renewForm.membership_fee} paid=${renewForm.amount_paid}`);
        try {
            const payload = {
                membership_type: renewForm.membership_type,
                amount_paid: renewForm.amount_paid === '' ? 0 : Number(renewForm.amount_paid),
                payment_mode: renewForm.payment_mode,
            };
            if (renewForm.membership_fee !== '') payload.membership_fee = Number(renewForm.membership_fee);
            const res = await api.put(`/clients/${renewMember.id}/renew`, payload);
            let msg = res.data.message;
            if (res.data.receipt) {
                msg += res.data.receipt.delivered === 'email'
                    ? ` Receipt emailed to ${res.data.receipt.recipient}.`
                    : ' Receipt printed to the server console (dev mode).';
            }
            setRenewOpen(false);
            toast.success(msg);
            setError('');
            log('MembersPage', 'handleRenewSubmit', `← renewed member ${renewMember.id}: ${msg}`);
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleRenewSubmit', `✗ renew failed for member ${renewMember?.id}: ${err.response?.data?.error || err.message}`, err);
            setRenewError(err.response?.data?.error || 'Failed to renew membership.');
        } finally {
            setRenewBusy(false);
        }
    };

    // ---- membership lifecycle (freeze / resume / upgrade / cancel) ----

    const addDaysStr = (dateStr, days) => {
        if (!dateStr) return '';
        const d = new Date(`${dateStr}T00:00:00`);
        if (isNaN(d.getTime())) return '';
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const freezePreview = (member, days) => {
        const n = Number(days) || 0;
        return {
            frozen_until: addDaysStr(todayISO(), n),
            new_expiry: member.membership_expiry ? addDaysStr(member.membership_expiry, n) : '—',
        };
    };

    const upgradePreview = (member, newType) => {
        const oldDays = MEMBERSHIP_DURATION_DAYS[member.membership_type] || 30;
        const newDays = MEMBERSHIP_DURATION_DAYS[newType] || 30;
        const diff = newDays - oldDays;
        const today = todayISO();
        const base = member.membership_expiry && member.membership_expiry >= today ? member.membership_expiry : today;
        return { new_expiry: diff > 0 ? addDaysStr(base, diff) : base, diff };
    };

    const openLifecycleMenu = (e, member) => {
        setMenuAnchor(e.currentTarget);
        setMenuMember(member);
    };

    const openFreeze = (member) => {
        setMenuAnchor(null);
        setFreezeMember(member);
        setFreezeForm({ days: 14, reason: '' });
        setFreezeError('');
        setFreezeOpen(true);
    };

    const openUpgrade = (member) => {
        setMenuAnchor(null);
        setUpgradeMember(member);
        setUpgradeForm({ membership_type: 'Quarterly', amount: '', method: member.payment_mode || 'Cash' });
        setUpgradeError('');
        setUpgradeOpen(true);
    };

    const openCancel = (member) => {
        setMenuAnchor(null);
        setCancelMember(member);
        setCancelEffective('now');
        setCancelError('');
        setCancelOpen(true);
    };

    const handleResume = async (member) => {
        log('MembersPage', 'handleResume', `→ resume member id=${member.id} code=${member.member_code}`);
        try {
            const res = await api.post(`/clients/${member.id}/resume`);
            toast.success(res.data.message);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleResume', `✗ resume failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to resume the member.');
        }
    };

    const handleFreezeSubmit = async () => {
        const days = Number(freezeForm.days);
        if (!days || days < 1 || days > 365) {
            setFreezeError('Freeze days must be between 1 and 365.');
            return;
        }
        setFreezeBusy(true);
        setFreezeError('');
        log('MembersPage', 'handleFreezeSubmit', `→ freeze member id=${freezeMember?.id} days=${days}`);
        try {
            const res = await api.post(`/clients/${freezeMember.id}/freeze`, {
                days,
                reason: freezeForm.reason.trim() || undefined,
            });
            setFreezeOpen(false);
            toast.success(res.data.message);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleFreezeSubmit', `✗ freeze failed for member ${freezeMember?.id}: ${err.response?.data?.error || err.message}`, err);
            setFreezeError(err.response?.data?.error || 'Failed to freeze the membership.');
        } finally {
            setFreezeBusy(false);
        }
    };

    const handleUpgradeSubmit = async () => {
        if (!upgradeForm.membership_type || upgradeForm.membership_type === upgradeMember.membership_type) {
            setUpgradeError('Pick a different plan.');
            return;
        }
        if (upgradeForm.amount !== '' && (Number(upgradeForm.amount) < 0 || isNaN(Number(upgradeForm.amount)))) {
            setUpgradeError('Amount must be a non-negative number.');
            return;
        }
        setUpgradeBusy(true);
        setUpgradeError('');
        log('MembersPage', 'handleUpgradeSubmit', `→ upgrade member id=${upgradeMember?.id} ${upgradeMember?.membership_type} → ${upgradeForm.membership_type}`);
        try {
            const payload = { membership_type: upgradeForm.membership_type };
            if (upgradeForm.amount !== '') payload.amount = Number(upgradeForm.amount);
            if (upgradeForm.amount !== '') payload.method = upgradeForm.method;
            const res = await api.post(`/clients/${upgradeMember.id}/upgrade`, payload);
            let msg = res.data.message;
            if (res.data.receipt) {
                msg += res.data.receipt.delivered === 'email'
                    ? ` Receipt emailed to ${res.data.receipt.recipient}.`
                    : ' Receipt printed to the server console (dev mode).';
            }
            setUpgradeOpen(false);
            toast.success(msg);
            setError('');
            log('MembersPage', 'handleUpgradeSubmit', `← upgraded member ${upgradeMember?.id}: ${msg}`);
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleUpgradeSubmit', `✗ upgrade failed for member ${upgradeMember?.id}: ${err.response?.data?.error || err.message}`, err);
            setUpgradeError(err.response?.data?.error || 'Failed to upgrade the membership.');
        } finally {
            setUpgradeBusy(false);
        }
    };

    const handleCancelSubmit = async () => {
        setCancelBusy(true);
        setCancelError('');
        log('MembersPage', 'handleCancelSubmit', `→ cancel membership member id=${cancelMember?.id} effective=${cancelEffective}`);
        try {
            const res = await api.post(`/clients/${cancelMember.id}/cancel`, { effective: cancelEffective });
            setCancelOpen(false);
            toast.success(res.data.message);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleCancelSubmit', `✗ cancel failed for member ${cancelMember?.id}: ${err.response?.data?.error || err.message}`, err);
            setCancelError(err.response?.data?.error || 'Failed to cancel the membership.');
        } finally {
            setCancelBusy(false);
        }
    };

    const confirm = useConfirm();

    const handleDeactivate = async (member) => {
        if (!await confirm({
            title: `Deactivate ${member.name}?`,
            body: <>They stop counting as an active member and can no longer check in. Their history and dues are kept, and you can reactivate them at any time.</>,
            confirmLabel: 'Deactivate', danger: true,
        })) return;
        log('MembersPage', 'handleDeactivate', `→ deactivate member id=${member.id} code=${member.member_code} name="${member.name}"`);
        try {
            await api.delete(`/clients/${member.id}`);
            toast.success(`Member "${member.name}" deactivated.`);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleDeactivate', `✗ deactivate failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to deactivate member.');
        }
    };

    const handlePurge = async (member) => {
        if (!await confirm({
            title: `Delete ${member.name} permanently?`,
            body: (
                <>
                    Their record and everything on it — payments, attendance, plans, bookings —
                    is removed for good. Invoices keep their numbers but stop pointing at anybody.
                    <br /><br />
                    <b>Member ID {member.member_code} goes back into the queue</b> and will be
                    offered to the next admission. Deactivating instead keeps both the record and
                    the ID.
                </>
            ),
            confirmLabel: 'Delete permanently', danger: true,
        })) return;
        log('MembersPage', 'handlePurge', `→ purge member id=${member.id} code=${member.member_code}`);
        try {
            const res = await api.delete(`/clients/${member.id}/purge`);
            toast.success(res.data.message);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handlePurge', `✗ purge failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to delete the member.');
        }
    };

    const handleReactivate = async (member) => {
        log('MembersPage', 'handleReactivate', `→ reactivate member id=${member.id} code=${member.member_code} name="${member.name}"`);
        try {
            await api.put(`/clients/${member.id}`, { status: 'active' });
            toast.success(`Member "${member.name}" reactivated.`);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleReactivate', `✗ reactivate failed for member ${member?.id}: ${err.response?.data?.error || err.message}`, err);
            setError(err.response?.data?.error || 'Failed to reactivate member.');
        }
    };

    const openRenumber = async (member) => {
        setRenumberMember(member);
        setRenumberCode('');
        setRenumberError('');
        setRenumberCount(0);
        setRenumberOpen(true);
        // Count how many attendance records carry this ID so the operator knows
        // what will be rewritten.
        try {
            const res = await api.get('/attendance');
            setRenumberCount(res.data.filter(a => String(a.member_id) === String(member.member_code)).length);
        } catch (err) {
            setRenumberCount(-1); // unknown
        }
    };

    const handleRenumber = async () => {
        const code = renumberCode.trim();
        if (!code) {
            setRenumberError('Enter the new Member ID.');
            return;
        }
        if (!/^\d+$/.test(code)) {
            setRenumberError('Member ID must contain numbers only.');
            return;
        }
        if (code === String(renumberMember.member_code)) {
            setRenumberError('New ID is the same as the current one.');
            return;
        }
        setRenumberBusy(true);
        setRenumberError('');
        log('MembersPage', 'handleRenumber', `→ renumber member id=${renumberMember?.id} ${renumberMember?.member_code} → ${code}`);
        try {
            const res = await api.put(`/clients/${renumberMember.id}/renumber`, { member_code: code });
            setRenumberOpen(false);
            toast.success(`${res.data.message} ${res.data.attendance_updated} attendance record(s) updated.`);
            setError('');
            fetchMembers();
        } catch (err) {
            logError('MembersPage', 'handleRenumber', `✗ renumber failed for member ${renumberMember?.id}: ${err.response?.data?.error || err.message}`, err);
            setRenumberError(err.response?.data?.error || 'Failed to renumber member.');
        } finally {
            setRenumberBusy(false);
        }
    };

    // Rendering every member as a card meant ~33k DOM nodes on a real roster,
    // and each keystroke in the search box re-rendered all of them (measured at
    // 2.7s per key). Show a page at a time instead.
    useEffect(() => { setVisibleCount(PAGE_SIZE); }, [search, filter]);

    const filtered = members.filter(m => {
        const q = search.trim().toLowerCase();
        const matchQ = !q || [m.name, m.phone, m.email, String(m.id)]
            .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
        const matchF = filter === 'all'
            || (filter === 'active' && m.status === 'active')
            || (filter === 'expiring' && m.expiry_status === 'expiring')
            || (filter === 'expired' && m.expiry_status === 'expired');
        return matchQ && matchF;
    });

    const visible = filtered.slice(0, visibleCount);
    const hiddenCount = filtered.length - visible.length;

    const counts = {
        all: members.length,
        active: members.filter(m => m.status === 'active').length,
        expiring: members.filter(m => m.expiry_status === 'expiring').length,
        expired: members.filter(m => m.expiry_status === 'expired').length,
    };

    return (
        <Box>
            <Alerts items={[
                error && { severity: 'error', text: error },
                loadError && { severity: 'error', text: loadError },
            ]} />

            {/* Toolbar */}
            <Paper sx={{ p: 2.5, mb: 3 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
                    <TextField
                        placeholder="Search name, phone, email, ID…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        size="small"
                        sx={{ flexGrow: 1, maxWidth: { md: 420 } }}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>
                            ),
                        }}
                    />
                    <Stack direction="row" spacing={1} sx={{ flexGrow: 1, overflowX: 'auto' }}>
                        {FILTERS.map(f => (
                            <Chip
                                key={f.id}
                                label={`${f.label} (${counts[f.id]})`}
                                clickable
                                color={filter === f.id ? 'primary' : 'default'}
                                variant={filter === f.id ? 'filled' : 'outlined'}
                                onClick={() => setFilter(f.id)}
                                sx={{ whiteSpace: 'nowrap' }}
                            />
                        ))}
                    </Stack>
                    {isAdmin && (
                        <Button variant="contained" startIcon={<Add />} onClick={openCreate} sx={{ flexShrink: 0 }}>
                            Add Member
                        </Button>
                    )}
                </Stack>
            </Paper>

            {/* Member cards */}
            {loading ? (
                <Grid container spacing={3}>
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Grid item xs={12} sm={6} lg={4} key={i}>
                            <Card sx={{ p: 2 }}>
                                <Box display="flex" alignItems="center" gap={1.5} mb={2}>
                                    <Skeleton variant="circular" width={40} height={40} />
                                    <Box sx={{ flexGrow: 1 }}>
                                        <Skeleton variant="text" width="60%" />
                                        <Skeleton variant="text" width="40%" />
                                    </Box>
                                </Box>
                                <Skeleton variant="text" width="80%" />
                                <Skeleton variant="text" width="55%" />
                                <Skeleton variant="text" width="70%" />
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            ) : filtered.length === 0 ? (
                <Paper sx={{ p: 0 }}>
                    <EmptyState
                        icon={Groups}
                        title={members.length === 0 ? 'No members yet' : 'No members match'}
                        hint={members.length === 0
                            ? 'Add your first member to start tracking memberships, attendance and payments.'
                            : 'Try a different name, phone number or member ID — or clear the status filter.'}
                        actionLabel={members.length === 0 && isAdmin ? 'Add Member' : undefined}
                        actionIcon={<Add />}
                        onAction={openCreate}
                    />
                </Paper>
            ) : (
                <Grid container spacing={3}>
                    {visible.map(m => {
                        const chip = expiryChip(m.expiry_status);
                        return (
                            <Grid item xs={12} sm={6} lg={4} key={m.id}>
                                <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                    <CardContent sx={{ flexGrow: 1, pb: 1 }}>
                                        <Box display="flex" alignItems="center" justifyContent="space-between">
                                            <Box display="flex" alignItems="center" gap={1.5}>
                                                <Avatar sx={{ ...avatarStyle(m), fontWeight: 700, fontSize: 15 }}>
                                                    {initialsOf(m.name)}
                                                </Avatar>
                                                <Box>
                                                    <Typography fontWeight={700} sx={{ lineHeight: 1.2 }}>{m.name}</Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        Member ID {m.member_code || m.id} · {m.status}
                                                    </Typography>
                                                </Box>
                                            </Box>
                                        </Box>

                                        <Divider sx={{ my: 1.5 }} />

                                        <Stack spacing={1}>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Badge fontSize="small" color="disabled" />
                                                {/* component="div" — a Chip renders a <div>, which can't nest inside a <p> */}
                                                <Typography variant="body2" component="div">
                                                    <b>{m.membership_type || '—'}</b> membership
                                                    {m.membership_expiry && (
                                                        <Chip
                                                            size="small" sx={{ ml: 1 }}
                                                            label={chip.label}
                                                            color={chip.color}
                                                            variant="outlined"
                                                        />
                                                    )}
                                                    {m.auto_renew && (
                                                        <Chip size="small" sx={{ ml: 0.5 }}
                                                            label="Auto-renew" color="primary" variant="outlined" />
                                                    )}
                                                    {m.frozen_until && m.frozen_until >= todayISO() && (
                                                        <Tooltip title={m.freeze_reason ? `Reason: ${m.freeze_reason}` : 'Membership on hold'}>
                                                            <Chip size="small" sx={{ ml: 0.5 }}
                                                                label={`Frozen till ${fmtDate(m.frozen_until)}`} color="error" variant="outlined" />
                                                        </Tooltip>
                                                    )}
                                                    {m.fingerprint_status === 'enrolled' && (
                                                        <Chip size="small" sx={{ ml: 0.5 }} label="Fingerprint" color="success" variant="outlined" />
                                                    )}
                                                    {m.fingerprint_status === 'pending' && (
                                                        <Chip size="small" sx={{ ml: 0.5 }} label="FP pending" color="warning" variant="outlined" />
                                                    )}
                                                    {m.card_uid && (
                                                        <Chip size="small" sx={{ ml: 0.5 }} label="Card" color="info" variant="outlined" />
                                                    )}
                                                </Typography>
                                            </Box>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Phone fontSize="small" color="disabled" />
                                                <Typography variant="body2">{m.phone || 'No phone'}</Typography>
                                            </Box>
                                            <Box display="flex" alignItems="center" gap={1}>
                                                <Person fontSize="small" color="disabled" />
                                                {/* "Trainer: —" reads as a value that failed to
                                                    load. Most members simply have not been given
                                                    one, which is a fact worth stating. */}
                                                <Typography variant="body2">
                                                    Trainer: {m.trainer_name || (
                                                        <Typography component="span" variant="body2" color="text.secondary">
                                                            not assigned
                                                        </Typography>
                                                    )}
                                                </Typography>
                                            </Box>
                                            <Typography variant="caption" color="text.secondary">
                                                Expires {m.membership_expiry ? fmtDate(m.membership_expiry) : '—'}
                                            </Typography>
                                            {Number(m.membership_fee) > 0 && (
                                                <Typography variant="caption" fontWeight={600}
                                                    color={Number(m.amount_due) > 0 ? 'error' : 'success'}>
                                                    {Number(m.amount_due) > 0
                                                        ? `Due ₹${Number(m.amount_due).toFixed(0)} · Paid ₹${Number(m.amount_paid).toFixed(0)}`
                                                        : 'Paid in full'}
                                                </Typography>
                                            )}
                                        </Stack>
                                    </CardContent>

                                    <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                                        <Button size="small" startIcon={<Visibility />} onClick={() => openDetail(m)}>
                                            View
                                        </Button>
                                        {isAdmin && (
                                            <>
                                                <Button size="small" startIcon={<Refresh />} onClick={() => openRenew(m)}>
                                                    Renew
                                                </Button>
                                                <Tooltip title="More actions">
                                                    <IconButton size="small" onClick={e => openLifecycleMenu(e, m)} aria-label={`More actions for ${m.name}`}>
                                                        <MoreVert fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </>
                                        )}
                                    </Box>
                                </Card>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            {hiddenCount > 0 && (
                <Box display="flex" justifyContent="center" alignItems="center" gap={2} mt={3}>
                    <Typography variant="body2" color="text.secondary">
                        Showing {visible.length} of {filtered.length} members
                    </Typography>
                    <Button variant="outlined" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
                        Show {Math.min(hiddenCount, PAGE_SIZE)} more
                    </Button>
                </Box>
            )}

            {/* Lifecycle actions menu */}
            <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
                {menuMember && (
                    <>
                        <MenuItem onClick={() => openFreeze(menuMember)}>
                            <AcUnit fontSize="small" sx={{ mr: 1 }} /> Freeze membership
                        </MenuItem>
                        {menuMember.frozen_until && menuMember.frozen_until >= todayISO() && (
                            <MenuItem onClick={() => { setMenuAnchor(null); handleResume(menuMember); }}>
                                <PlayCircleOutline fontSize="small" sx={{ mr: 1 }} /> Resume (end freeze)
                            </MenuItem>
                        )}
                        <MenuItem onClick={() => openUpgrade(menuMember)}>
                            <Upgrade fontSize="small" sx={{ mr: 1 }} /> Upgrade plan
                        </MenuItem>
                        <MenuItem onClick={() => openCancel(menuMember)}>
                            <Block fontSize="small" sx={{ mr: 1 }} /> Cancel membership
                        </MenuItem>
                        <Divider sx={{ my: 0.5 }} />
                        <MenuItem onClick={() => { setMenuAnchor(null); openRenumber(menuMember); }}>
                            <SwapHoriz fontSize="small" sx={{ mr: 1 }} /> Renumber member ID
                        </MenuItem>
                        {menuMember.status === 'active' ? (
                            <MenuItem
                                onClick={() => { setMenuAnchor(null); handleDeactivate(menuMember); }}
                                sx={{ color: 'error.main' }}
                            >
                                <Delete fontSize="small" sx={{ mr: 1 }} /> Deactivate member
                            </MenuItem>
                        ) : (
                            <>
                                <MenuItem onClick={() => { setMenuAnchor(null); handleReactivate(menuMember); }}>
                                    <Restore fontSize="small" sx={{ mr: 1 }} /> Reactivate member
                                </MenuItem>
                                {/* Only once they are inactive, and only for an admin:
                                    this is the one action that frees a Member ID. */}
                                {isAdmin && (
                                    <MenuItem
                                        onClick={() => { setMenuAnchor(null); handlePurge(menuMember); }}
                                        sx={{ color: 'error.main' }}
                                    >
                                        <DeleteForever fontSize="small" sx={{ mr: 1 }} /> Delete permanently
                                    </MenuItem>
                                )}
                            </>
                        )}
                    </>
                )}
            </Menu>

            {/* Detail / Create dialog */}
            <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="md" fullWidth>
                <DialogTitle>
                    {editing ? `Member — ${editing.name}`
                        : onboardLead ? `Onboard lead — ${onboardLead.name}` : 'Add Member'}
                </DialogTitle>
                <Tabs value={detailTab} onChange={(e, v) => setDetailTab(v)} sx={{ px: 3 }}>
                    <Tab label="Details" />
                    <Tab label="Payments" />
                    <Tab label="Workout" />
                    <Tab label="Diet" />
                    <Tab label="Progress" />
                </Tabs>
                <DialogContent dividers>
                    {detailTab === 0 && (
                        <>
                            {/* One alert for the whole form, like every other form in
                                the app. Spreading formErrors gave one pill per field,
                                so five missing fields became five boxes wrapping into
                                a red thicket — and the fields themselves are already
                                outlined in red, so the list is a summary, not the
                                only signpost. */}
                            <Alerts items={[
                                !editing && onboardLead && {
                                    severity: 'info',
                                    text: `Converting a ${onboardLead.source || 'walk-in'} lead from `
                                        + `${fmtDate(onboardLead.created_at)} — their details are filled in.`,
                                },
                                error && { severity: 'error', text: error },
                                formErrorList.length > 0 && {
                                    severity: 'error',
                                    title: formErrorList.length === 1
                                        ? 'One field needs attention'
                                        : `${formErrorList.length} fields need attention`,
                                    lines: formErrorList,
                                },
                            ]} />

                            <Section icon={Person} title="Personal details" first>
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={3}>
                                    <TextField
                                        fullWidth required
                                        label="Member ID"
                                        name="member_code"
                                        value={form.member_code}
                                        onChange={handleFormChange}
                                        error={!!formErrors.member_code}
                                        inputProps={{ inputMode: 'numeric' }}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={9}>
                                    <TextField fullWidth required label="Full name" name="name" value={form.name}
                                        onChange={handleFormChange}
                                        onBlur={titleCaseOnBlur(setForm)}
                                        error={!!formErrors.name}
                                        />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required label="Phone" name="phone" value={form.phone}
                                        onChange={handleFormChange}
                                        error={!!formErrors.phone}
                                        />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Email" name="email" value={form.email}
                                        onChange={handleFormChange}
                                        error={!!formErrors.email}
                                        />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        select fullWidth required
                                        label="Gender"
                                        name="gender"
                                        value={form.gender || ''}
                                        onChange={handleFormChange}
                                        error={!!formErrors.gender}
                                        InputLabelProps={{ shrink: true }}
                                        SelectProps={{ displayEmpty: true }}
                                    >
                                        {/* "Not set" read like an answer on a mandatory field —
                                            the form looked filled in and then refused to save. */}
                                        <MenuItem value="" disabled><em>Select…</em></MenuItem>
                                        {GENDERS.map(g => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required type="date" label="Join date" name="join_date" value={form.join_date}
                                        onChange={handleFormChange} error={!!formErrors.join_date}
                                        InputLabelProps={{ shrink: true }} />
                                </Grid>
                            </Grid>
                            </Section>

                            <Section icon={Badge} title="Membership">
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <TextField select fullWidth required label="Membership type" name="membership_type" value={form.membership_type}
                                        onChange={handleFormChange} error={!!formErrors.membership_type}>
                                        {planNames.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField select fullWidth required label="Status" name="status" value={form.status}
                                        onChange={handleFormChange} error={!!formErrors.status}>
                                        <MenuItem value="active">Active</MenuItem>
                                        <MenuItem value="inactive">Inactive</MenuItem>
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required type="date" label="Membership start" name="membership_start" value={form.membership_start}
                                        onChange={handleFormChange} error={!!formErrors.membership_start}
                                        InputLabelProps={{ shrink: true }} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required type="date" label="Expiry (auto)" name="membership_expiry" value={form.membership_expiry}
                                        onChange={handleFormChange} error={!!formErrors.membership_expiry}
                                        InputLabelProps={{ shrink: true }} />
                                </Grid>
                                {form.membership_type === 'Custom' && (
                                    <Grid item xs={12} sm={6}>
                                        <TextField
                                            fullWidth type="number"
                                            label="Custom days"
                                            name="custom_duration_days"
                                            value={form.custom_duration_days}
                                            onChange={handleFormChange}
                                            helperText="Sets the expiry."
                                        />
                                    </Grid>
                                )}
                                {isAdmin && (
                                    <Grid item xs={12} sm={6}>
                                        {/* Half width, like everything above it — full width with
                                            an empty helper line left a hole under the section. */}
                                        <TextField select fullWidth label="Trainer"
                                            name="trainer_id" value={form.trainer_id}
                                            onChange={handleFormChange} error={!!formErrors.trainer_id}
                                            helperText={trainers.length === 0
                                                ? 'Add a trainer on the Users page first.'
                                                : 'Optional — can be assigned later.'}>
                                            <MenuItem value=""><em>Not assigned</em></MenuItem>
                                            {trainers.map(t => (
                                                <MenuItem key={t.id} value={t.id}>{t.name || t.username}</MenuItem>
                                            ))}
                                        </TextField>
                                    </Grid>
                                )}
                            </Grid>
                            </Section>

                            <Section icon={Fingerprint} title="Gate access" hint="how they get in">
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <ToggleField
                                        checked={!!form.activate_fingerprint}
                                        onChange={e => setForm({ ...form, activate_fingerprint: e.target.checked })}
                                        label="Fingerprint"
                                        hint="Sent to the machine on save."
                                    >
                                        {editing && form.fingerprint_status_display && (
                                            <Chip size="small" sx={{ mt: 0.75, ml: 5.5, alignSelf: 'flex-start' }}
                                                label={form.fingerprint_status_display}
                                                color={form.fingerprint_status_display === 'Fingerprint enrolled' ? 'success' : 'warning'} />
                                        )}
                                    </ToggleField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField
                                        fullWidth
                                        label="Card number"
                                        name="card_uid"
                                        value={form.card_uid || ''}
                                        onChange={handleFormChange}
                                        placeholder="0012345678"
                                        helperText="RFID card. Swiping punches them in."
                                    />
                                </Grid>
                            </Grid>

                            </Section>

                            <Section icon={Lock} title="Locker" hint="optional">
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <ToggleField
                                        checked={!!form.assign_locker}
                                        onChange={e => setForm({
                                            ...form,
                                            assign_locker: e.target.checked,
                                            // Turning it back off clears the fields, so a
                                            // half-typed number cannot be saved by accident.
                                            ...(e.target.checked ? {} : {
                                                locker_number: '', locker_amount: '', locker_until: '',
                                            }),
                                        })}
                                        label="Assign a locker"
                                        hint="Billed and invoiced if charged."
                                    />
                                </Grid>
                                {form.assign_locker && (
                                    <>
                                        <Grid item xs={12} sm={6}>
                                            <TextField
                                                fullWidth
                                                label="Locker number"
                                                name="locker_number"
                                                value={form.locker_number || ''}
                                                onChange={handleFormChange}
                                                placeholder="L-101"
                                                error={!!formErrors.locker_number}
                                                helperText={formErrors.locker_number || 'Created if it is new.'}
                                            />
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <TextField
                                                fullWidth
                                                type="number"
                                                label="Charge (₹)"
                                                name="locker_amount"
                                                value={form.locker_amount || ''}
                                                onChange={handleFormChange}
                                                inputProps={{ min: 0 }}
                                                error={!!formErrors.locker_amount}
                                                helperText={formErrors.locker_amount || 'Blank if included.'}
                                            />
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <TextField
                                                fullWidth
                                                type="date"
                                                label="Valid until"
                                                name="locker_until"
                                                value={form.locker_until || ''}
                                                onChange={handleFormChange}
                                                InputLabelProps={{ shrink: true }}
                                                error={!!formErrors.locker_until}
                                                helperText={formErrors.locker_until || 'Defaults to a month.'}
                                            />
                                        </Grid>
                                    </>
                                )}
                            </Grid>

                            </Section>

                            {!editing && (
                                <Section icon={CardGiftcard} title="Referred by" hint="optional">
                                    <Grid container spacing={2}>
                                        <Grid item xs={12} sm={6}>
                                            {/* Only on a new member: who introduced someone is
                                                settled at the door and never changes afterwards,
                                                and editing it later would move a paid reward. */}
                                            <TextField
                                                fullWidth
                                                label="Referral code"
                                                name="referral_code"
                                                value={form.referral_code || ''}
                                                onChange={handleFormChange}
                                                placeholder="AARA0744"
                                                inputProps={{ maxLength: 16 }}
                                                error={!!formErrors.referral_code}
                                                helperText={formErrors.referral_code
                                                    || 'Their reward lands when this is paid in full.'}
                                            />
                                        </Grid>
                                    </Grid>
                                </Section>
                            )}

                            <Section icon={Payments} title="Payment">
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required type="number" label="Membership fee" name="membership_fee" value={form.membership_fee}
                                        onChange={handleFormChange} error={!!formErrors.membership_fee}
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth required type="number" label="Amount paid" name="amount_paid" value={form.amount_paid}
                                        onChange={handleFormChange} error={!!formErrors.amount_paid}
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField select fullWidth required label="Mode of payment" name="payment_mode" value={form.payment_mode}
                                        onChange={handleFormChange} error={!!formErrors.payment_mode}>
                                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    {/* readOnly, not disabled. It is computed, so it must not be
                                        typed into — but a disabled input greys its value out, and
                                        this is the number the desk acts on: it decides whether the
                                        gate opens. Emphasised in red while anything is owed. */}
                                    <TextField fullWidth type="number" label="Amount due" name="amount_due" value={form.amount_due}
                                        InputProps={{
                                            readOnly: true,
                                            startAdornment: <InputAdornment position="start">₹</InputAdornment>,
                                        }}
                                        sx={Number(form.amount_due) > 0
                                            ? { '& input': { color: 'error.main', fontWeight: 700 } }
                                            : undefined}
                                        helperText="Fee − paid. The gate stays locked until it is cleared."
                                    />
                                </Grid>
                            </Grid>

                            </Section>

                            <Section icon={Autorenew} title="Auto-renew" hint="optional">
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <ToggleField
                                        checked={!!form.auto_renew}
                                        onChange={e => setForm({ ...form, auto_renew: e.target.checked })}
                                        label="Renew on expiry"
                                        hint="Charges the plan fee and extends."
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Saved method" name="recurring_method" value={form.recurring_method || ''}
                                        onChange={handleFormChange} placeholder="Card •••• 4242"
                                        helperText="Blank disables auto-charging." />
                                </Grid>
                            </Grid>
                            </Section>
                        </>
                    )}
                    {detailTab === 1 && (editing
                        ? <MemberPaymentsTab memberId={editing.id} isAdmin={isAdmin} />
                        : <NotSavedTab title="Payments" description="Record the initial payment and track every payment this member makes." />)}
                    {detailTab === 2 && (editing
                        ? <MemberWorkoutTab memberId={editing.id} />
                        : <NotSavedTab title="Workout" description="Build and edit the member's weekly workout plan." />)}
                    {detailTab === 3 && (editing
                        ? <MemberDietTab memberId={editing.id} />
                        : <NotSavedTab title="Diet" description="Set the member's meal-by-meal diet and nutrition plan." />)}
                    {detailTab === 4 && (editing
                        ? <MemberProgressTab memberId={editing.id} />
                        : <NotSavedTab title="Progress" description="Track weight, body fat and other measurements over time." />)}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDetailOpen(false)}>Close</Button>
                    {detailTab === 0 && (
                        <Button variant="contained" onClick={handleSave}>
                            {editing ? 'Save Changes' : 'Add Member'}
                        </Button>
                    )}
                </DialogActions>
            </Dialog>

            {/* Renumber ID dialog */}
            <Dialog open={renumberOpen} onClose={() => setRenumberOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Renumber Member ID</DialogTitle>
                <DialogContent>
                    {renumberMember && (
                        <Box sx={{ mt: 0.5 }}>
                            <Alerts items={[renumberError && { severity: 'error', text: renumberError }]} />
                            <Typography variant="body2" mb={2}>
                                <b>{renumberMember.name}</b> — current ID <b>{renumberMember.member_code}</b>
                            </Typography>
                            <TextField
                                fullWidth autoFocus
                                label="New Member ID"
                                value={renumberCode}
                                onChange={e => setRenumberCode(e.target.value.replace(/\D/g, ''))}
                                inputProps={{ inputMode: 'numeric' }}
                            />
                            <Alert severity="info" sx={{ mt: 2 }}>
                                {renumberCount >= 0
                                    ? `${renumberCount} attendance record(s) under the old ID will be updated to the new ID.`
                                    : 'Attendance history will be updated to match the new ID.'}
                                The new ID must be free — old IDs stop working immediately after the change.
                            </Alert>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenumberOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained" startIcon={<SwapHoriz />}
                        onClick={handleRenumber}
                        disabled={renumberBusy || !renumberCode.trim()}
                    >
                        {renumberBusy ? 'Renumbering…' : 'Renumber'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Renew dialog */}
            <Dialog open={renewOpen} onClose={() => setRenewOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Renew Membership</DialogTitle>
                <DialogContent>
                    {renewMember && (
                        <Box sx={{ mt: 0.5 }}>
                            <Alerts items={[renewError && { severity: 'error', text: renewError }]} />
                            <Typography variant="body2" mb={2}>
                                <b>{renewMember.name}</b> (ID {renewMember.member_code})
                                {renewMember.membership_expiry && (
                                    <> — currently valid until <b>{renewMember.membership_expiry}</b></>
                                )}
                            </Typography>
                            <Grid container spacing={2}>
                                <Grid item xs={12}>
                                    <TextField select fullWidth label="Membership Type" value={renewForm.membership_type}
                                        onChange={e => setRenewForm({ ...renewForm, membership_type: e.target.value })}>
                                        {planNames.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth type="number" label="Renewal Fee (₹)" value={renewForm.membership_fee}
                                        onChange={e => setRenewForm({ ...renewForm, membership_fee: e.target.value })}
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth type="number" label="Amount Paid (₹)" value={renewForm.amount_paid}
                                        onChange={e => setRenewForm({ ...renewForm, amount_paid: e.target.value })}
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField select fullWidth label="Mode of Payment" value={renewForm.payment_mode}
                                        onChange={e => setRenewForm({ ...renewForm, payment_mode: e.target.value })}>
                                        {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                                    </TextField>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Amount Due (₹)" value={renewDue.toFixed(2)} disabled
                                        InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                                        helperText={renewDue > 0 ? 'Auto-computed: fee − paid' : 'Fully paid'}
                                        sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }} />
                                </Grid>
                            </Grid>
                            <Alert severity="info" sx={{ mt: 2 }}>
                                The member ID stays the same. A payment of the paid amount is recorded in the
                                ledger and a receipt is emailed (if the member has an email).
                            </Alert>
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setRenewOpen(false)}>Cancel</Button>
                    <Button variant="contained" startIcon={<Refresh />} onClick={handleRenewSubmit} disabled={renewBusy}>
                        {renewBusy ? 'Renewing…' : 'Renew'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Freeze dialog */}
            <Dialog open={freezeOpen} onClose={() => setFreezeOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Freeze Membership — {freezeMember?.name}</DialogTitle>
                <DialogContent>
                    <Alerts items={[freezeError && { severity: 'error', text: freezeError }]} />
                    {freezeMember && (
                        <>
                            <Typography variant="body2" color="text.secondary" mb={2}>
                                The membership pauses and the expiry is pushed forward by the same number of days.
                                The gate stays <b>locked</b> while frozen.
                            </Typography>
                            <Stack direction="row" spacing={1} mb={2}>
                                {[7, 14, 30].map(d => (
                                    <Chip key={d} label={`${d} days`} clickable
                                        color={Number(freezeForm.days) === d ? 'primary' : 'default'}
                                        variant={Number(freezeForm.days) === d ? 'filled' : 'outlined'}
                                        onClick={() => setFreezeForm({ ...freezeForm, days: d })} />
                                ))}
                            </Stack>
                            <TextField fullWidth size="small" type="number" label="Freeze days"
                                value={freezeForm.days} inputProps={{ min: 1, max: 365 }}
                                onChange={e => setFreezeForm({ ...freezeForm, days: e.target.value })} />
                            <TextField fullWidth size="small" label="Reason (optional)" sx={{ mt: 2 }}
                                value={freezeForm.reason} placeholder="e.g. vacation / injury / travel"
                                onChange={e => setFreezeForm({ ...freezeForm, reason: e.target.value })} />
                            <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                                <Typography variant="body2">Expiry: {freezeMember.membership_expiry || '—'}
                                    {' → '}
                                    <b>{freezePreview(freezeMember, freezeForm.days).new_expiry}</b>
                                </Typography>
                                <Typography variant="body2">Gate: <b>locked until {freezePreview(freezeMember, freezeForm.days).frozen_until}</b></Typography>
                            </Box>
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setFreezeOpen(false)}>Cancel</Button>
                    <Button variant="contained" color="error" startIcon={<AcUnit />} onClick={handleFreezeSubmit} disabled={freezeBusy}>
                        {freezeBusy ? 'Freezing…' : 'Freeze membership'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Upgrade dialog */}
            <Dialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Upgrade Plan — {upgradeMember?.name}</DialogTitle>
                <DialogContent>
                    <Alerts items={[upgradeError && { severity: 'error', text: upgradeError }]} />
                    {upgradeMember && (
                        <>
                            <Typography variant="body2" color="text.secondary" mb={2}>
                                Current plan: <b>{upgradeMember.membership_type}</b> · expires {upgradeMember.membership_expiry || '—'}
                            </Typography>
                            <TextField select fullWidth size="small" label="New plan"
                                value={upgradeForm.membership_type}
                                onChange={e => setUpgradeForm({ ...upgradeForm, membership_type: e.target.value })}>
                                {planNames.filter(t => t !== upgradeMember.membership_type).map(t => (
                                    <MenuItem key={t} value={t}>{t}</MenuItem>
                                ))}
                            </TextField>
                            {(() => {
                                const p = upgradePreview(upgradeMember, upgradeForm.membership_type);
                                return (
                                    <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
                                        <Typography variant="body2">
                                            New expiry: <b>{p.new_expiry}</b>
                                            {p.diff > 0 ? ` (+${p.diff} days)` : p.diff < 0 ? ' (unchanged — you never lose paid time)' : ' (unchanged)'}
                                        </Typography>
                                    </Box>
                                );
                            })()}
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="body2" fontWeight={600} mb={1}>Upgrade charge (optional)</Typography>
                            <Box display="flex" gap={1.5}>
                                <TextField fullWidth size="small" type="number" label="Amount (₹)" value={upgradeForm.amount}
                                    onChange={e => setUpgradeForm({ ...upgradeForm, amount: e.target.value })}
                                    inputProps={{ min: 0 }} />
                                <TextField select fullWidth size="small" label="Method" value={upgradeForm.method}
                                    onChange={e => setUpgradeForm({ ...upgradeForm, method: e.target.value })}>
                                    {PAYMENT_MODES.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                                </TextField>
                            </Box>
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUpgradeOpen(false)}>Cancel</Button>
                    <Button variant="contained" startIcon={<Upgrade />} onClick={handleUpgradeSubmit} disabled={upgradeBusy}>
                        {upgradeBusy ? 'Upgrading…' : 'Upgrade plan'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Cancel dialog */}
            <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Cancel Membership — {cancelMember?.name}</DialogTitle>
                <DialogContent>
                    <Alerts items={[cancelError && { severity: 'error', text: cancelError }]} />
                    {cancelMember && (
                        <RadioGroup value={cancelEffective} onChange={e => setCancelEffective(e.target.value)}>
                            <FormControlLabel value="now" control={<Radio />} label={
                                <Box>
                                    <Typography variant="body2" fontWeight={600}>End now</Typography>
                                    <Typography variant="caption" color="text.secondary">Access stops immediately and the gate is locked.</Typography>
                                </Box>
                            } />
                            <FormControlLabel value="expiry" control={<Radio />} label={
                                <Box>
                                    <Typography variant="body2" fontWeight={600}>End at expiry ({cancelMember.membership_expiry || '—'})</Typography>
                                    <Typography variant="caption" color="text.secondary">Access continues until then; auto-renew is turned off.</Typography>
                                </Box>
                            } />
                        </RadioGroup>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCancelOpen(false)}>Cancel</Button>
                    <Button variant="contained" color="error" startIcon={<Block />} onClick={handleCancelSubmit} disabled={cancelBusy}>
                        {cancelBusy ? 'Cancelling…' : 'Cancel membership'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default MembersPage;
