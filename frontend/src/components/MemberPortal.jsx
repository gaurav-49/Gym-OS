// frontend/src/components/MemberPortal.jsx
// Member self-service portal. A member signs in with their Member ID and a
// password — everyone starts on the gym default ("admin"), and the sign-in
// screen also carries "change password" and "forgot password" so they can move
// off it whenever they like. They get:
//   Overview  — membership plan, dues, and the QR code to show at the desk
//   Classes   — book / waitlist / cancel (shared MemberClassGrid)
//   Workouts  — their weekly plan (read-only)
//   Diet      — their nutrition plan (read-only)
//   Progress  — latest body metrics + weight trend
//   Attendance— their check-in history, read-only
//
// Note what is deliberately absent: a way to check yourself in. A member's own
// token is all a self check-in would need, so it could be done from the sofa
// and proved nothing about who was at the gym. The QR here is something to
// present; only a staff scan in the main app writes attendance.
//
// Accessible publicly at http://localhost:5173/#/member
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import {
    Box, Paper, Typography, TextField, Button, Stack, Alert, Avatar, Chip, GridLegacy as Grid, Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Divider, LinearProgress, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, } from '@mui/material';
import {
    Badge, Lock, LockReset, Key, Email, Sms, ArrowBack, Logout, QrCode2, EventAvailable,
    FitnessCenter, Restaurant, MonitorWeight, FactCheck, CheckCircle, Schedule, TrendingUp,
    Info, CardGiftcard, ContentCopy, Share, StorefrontOutlined, ReceiptLong, Download, HistoryEdu,
    SelfImprovement, MailOutline, PhoneIphone,
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import api from '../api';
import { log, logError } from '../logger';
import Alerts from './Alerts';
import MemberClassGrid from './MemberClassGrid';
import { fmtDate, money } from './ui/format';
import { printReceipt, receiptNo, describePayment } from './ui/receipt';
import { printInvoice } from './ui/invoice';
import useBranding from './ui/useBranding';
import PoweredBy from './ui/PoweredBy';
import ModuleNav from './ui/ModuleNav';
import { Figure, Ring, Stat } from './ui/Readout';
import { signInGround, signInRail, signInRailInner, signInCard, signInQuote, signInRule } from './ui/signInLook';
import Ledger from './ui/Ledger';
import ThemeToggle from './ui/ThemeToggle';
import useThemeMode from './ui/useThemeMode';
import { buildMemberTheme, portalTokens, passFor } from '../memberTheme';

// Dates and money come from the shared helpers. This file used to carry its
// own fmtDate that did `new Date(`${d}T00:00:00`)` unconditionally, which is
// right for a bare "2026-09-06" and produces "Invalid Date" for anything that
// already has a time on it — referrals.created_at is a full timestamp, so
// every invitation showed its date as "Invalid Date". The shared one checks
// the length first, and formats as en-GB like the rest of the app.
const fmtTime = (t) => (t ? String(t).slice(0, 5) : '—');

// Referral status, worded for the member rather than for the column it is
// stored in. 'lost' is the gym's word; "Not joined" is the member's.
const referralStatusLabel = (status) => (
    status === 'rewarded' ? 'Rewarded'
        : status === 'joined' ? 'Joined'
        : status === 'lost' ? 'Not joined' : 'Pending');
const referralStatusColor = (status) => (
    status === 'rewarded' || status === 'joined' ? 'success'
        : status === 'lost' ? 'default' : 'warning');
const fmtMoney = money;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Custom'];
const MEALS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Supplements'];

// Tabs are addressed by name, not by number. The Personal Training tab only
// exists for members who have a trainer, so the positions after it shift — and
// a hardcoded `tab === 7` would silently point at the wrong panel for half the
// members. (This started life as a bare `tab !== 6` for the referral tab.)
const TAB_KEYS = ['overview', 'classes', 'workouts', 'diet', 'progress',
    'attendance', 'payments', 'training', 'locker', 'refer'];

// Two of these are conditional, so the positions after them shift by member.
const tabsFor = (hasPt, hasLocker) => TAB_KEYS.filter(k =>
    (k !== 'training' || hasPt) && (k !== 'locker' || hasLocker));

const TabPanel = ({ value, index, children }) => (
    <Box sx={{ display: value === index ? 'block' : 'none' }}>{children}</Box>
);

// A number the member reads between sets: the value large and tabular, the unit
// small underneath. "4 sets · 8 reps · 45 kg · 90s rest" is one long string to
// parse; these are four things to glance at.
const Metric = ({ value, label }) => (
    <Box sx={{ minWidth: 0 }}>
        <Typography component="div" sx={{
            fontSize: 15, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums',
        }}>{value}</Typography>
        <Typography component="div" sx={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'text.secondary', mt: 0.25, whiteSpace: 'nowrap',
        }}>{label}</Typography>
    </Box>
);

// One entry in a plan — an exercise, or a meal item. Deliberately NOT an inset
// plate: a surface laid on a surface is exactly what put near-white text on a
// near-white ground here, and it buys nothing a rule and a rail don't. The rail
// stays neutral on purpose — in this theme green means the member is winning
// (days left, a logged visit, a cleared balance), and a list of things they
// still have to do is not that.
const PlanRow = ({ rail, title, trailing, metrics, note, divider }) => (
    <Box sx={{
        display: 'flex', gap: 1.5, py: 1.75,
        borderTop: divider ? '1px solid' : 0, borderColor: 'divider',
    }}>
        <Box sx={{ width: 3, borderRadius: 3, bgcolor: rail, flexShrink: 0, alignSelf: 'stretch' }} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
                <Typography component="div" sx={{
                    fontSize: 15, fontWeight: 700, lineHeight: 1.35, flexGrow: 1, minWidth: 0,
                }}>{title}</Typography>
                {trailing}
            </Box>
            {metrics && metrics.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.75, rowGap: 1, mt: 1.25 }}>
                    {metrics.map(m => <Metric key={m.label} value={m.value} label={m.label} />)}
                </Box>
            )}
            {note && (
                <Typography component="div" variant="body2" color="text.secondary"
                    sx={{ mt: 1.25, fontStyle: 'italic' }}>{note}</Typography>
            )}
        </Box>
    </Box>
);

// The heading of a day or a meal, with the one summary figure that heading can
// honestly carry: how many moves, or what the meal adds up to.
const PlanHead = ({ title, summary }) => (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, pb: 0.25 }}>
        <Typography variant="subtitle1" fontWeight={800} sx={{ flexGrow: 1, minWidth: 0 }}>{title}</Typography>
        {summary && (
            <Typography variant="caption" color="text.secondary"
                sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{summary}</Typography>
        )}
    </Box>
);

// Plan cards are never the same height — one meal has two items, the next has
// one — and there are only two honest answers. Masonry packs by height but
// leaves the columns ending at different depths, which reads as broken
// alignment. A row grid keeps every bottom edge on one line at the cost of some
// space inside the shortest card. Measured, the ragged version differed by 94px
// across three Diet cards; since the redesign made the cards compact, the
// leftover space in a short card is now small enough that the tidier row wins.
const PlanGrid = ({ children }) => (
    <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
        gap: 2,
        // Cards stretch to the tallest in their row; the content stays top-aligned.
        alignItems: 'stretch',
        '& > *': { height: '100%' },
    }}>
        {children}
    </Box>
);

const MemberPortal = () => {
    const [token, setToken] = useState(() => localStorage.getItem('gym_member_token') || '');

    // Appearance. The portal is dark-first, so a member whose device tells us
    // nothing gets ink rather than paper. The stored choice arrives with /me
    // and is adopted below.
    const saveTheme = useCallback(
        (choice) => api.put('/member/preferences', { theme: choice }), []);
    // `themeMode`, not `mode`: the sign-in screen already owns a `mode`
    // (signin / change / forgot).
    const { mode: themeMode, toggle: toggleTheme, adopt: adoptTheme, reset: resetTheme } =
        useThemeMode('gym_member_theme', saveTheme, 'dark');
    const portalTheme = useMemo(() => buildMemberTheme(themeMode), [themeMode]);
    // The shell (sign-in background, hero band, chips) sits outside MUI's
    // component styles, so it reads the tokens directly.
    const T = portalTokens(themeMode);
    const PASS = passFor(themeMode);
    const onInk = themeMode === 'dark';
    // Every render path goes through this: the sign-in screen, the loading
    // spinner and the portal itself. CssBaseline is re-applied inside the
    // provider so the page ground follows the portal's theme rather than the
    // staff theme mounted above it in main.jsx.
    const shell = (children) => (
        <ThemeProvider theme={portalTheme}>
            <CssBaseline />
            {children}
        </ThemeProvider>
    );
    const [member, setMember] = useState(() => {
        try { return JSON.parse(localStorage.getItem('gym_member_user') || 'null'); } catch { return null; }
    });
    const [form, setForm] = useState({
        member_code: '', password: '', current_password: '', new_password: '', confirm: '', otp: '',
    });
    const secretRef = useRef(null);
    // 'signin'  → Member ID + password (everyone starts on the gym default)
    // 'change'  → prove the current password, choose a new one
    // 'forgot'  → OTP to the number/address on file, then a new password
    const [mode, setMode] = useState('signin');
    // Forgot flow: 'choose' picks where the OTP goes, 'otp' enters it.
    const [forgotStep, setForgotStep] = useState('choose');
    const [recovery, setRecovery] = useState(null);
    const [resendIn, setResendIn] = useState(0);
    const [devOtp, setDevOtp] = useState('');
    // The in-portal "you are still on the gym default" prompt. Changing from
    // here returns a fresh session, so the member is never signed out to do it.
    const [changeOpen, setChangeOpen] = useState(false);
    const [receiptError, setReceiptError] = useState('');
    const brand = useBranding();
    const [referral, setReferral] = useState(null);
    const [inviteForm, setInviteForm] = useState({ referred_name: '', referred_phone: '' });
    const [inviteMsg, setInviteMsg] = useState('');
    const [inviteErr, setInviteErr] = useState('');
    const [copied, setCopied] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);

    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [tab, setTab] = useState(0);
    const [qrUrl, setQrUrl] = useState('');

    // Declared before the effects that depend on it: the dependency arrays are
    // evaluated during render, so a const defined further down would be in the
    // temporal dead zone by the time they run.
    const hasTrainer = !!data?.trainer;
    // Personal training shows only to members who have actually bought it.
    // A trainer named on the record is not the same thing — plenty of gyms put
    // a floor trainer against everybody — and gating on that gave ordinary
    // members a tab about a product they had never signed up for.
    const hasPt = (data?.pt_subscriptions || []).length > 0;
    // Same rule as personal training: a member who has not taken a locker is
    // not shown a tab about one.
    const hasLocker = !!data?.locker;
    // Who the member trains with. The plan remembers the trainer who sold it,
    // which is what still answers the question after that trainer has left and
    // the member's record no longer names anyone.
    const ptTrainer = data?.trainer
        || (data?.pt_subscriptions || []).find(p => p.trainer_name)
        || null;
    const ptTrainerName = ptTrainer?.name || ptTrainer?.trainer_name || null;
    const TAB = (key) => tabsFor(hasPt, hasLocker).indexOf(key);

    // Icon + label for every destination, in TAB_KEYS order. Derived from the
    // same tabsFor() the panels use so the two can never disagree.
    const NAV_META = {
        overview:   { label: 'Overview',   icon: QrCode2 },
        classes:    { label: 'Classes',    icon: EventAvailable },
        workouts:   { label: 'Workouts',   icon: FitnessCenter },
        diet:       { label: 'Diet',       icon: Restaurant },
        progress:   { label: 'Progress',   icon: MonitorWeight },
        // 'Attendance' overflows a 5-column tile at 320px; 'Visits' is
        // what the panel actually shows and fits on one line.
        attendance: { label: 'Visits',     icon: FactCheck },
        // "Membership & payments" is the tab's full name and it does not fit a
        // 64px tile; the panel keeps the long heading, the tile says Payments.
        payments:   { label: 'Payments',   icon: ReceiptLong },
        training:   { label: 'Training',   icon: SelfImprovement },
        locker:     { label: 'Locker',     icon: Lock },
        refer:      { label: 'Refer',      icon: CardGiftcard },
    };
    const navItems = tabsFor(hasPt, hasLocker).map(key => ({ key, ...NAV_META[key] }));

    const fetchMe = async () => {
        if (!token) return;
        try {
            log('MemberPortal', 'fetchMe', `→ loading profile for member_code="${member?.member_code || '?'}"`);
            const res = await api.get('/member/me');
            setData(res.data);
            // The member may have chosen dark on their phone and be looking at
            // a borrowed laptop; the stored choice wins over this device's cache.
            adoptTheme(res.data.theme_preference);
            setError('');
        } catch (err) {
            logError('MemberPortal', 'fetchMe', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            if (err.response?.status === 401) {
                localStorage.removeItem('gym_member_token');
                localStorage.removeItem('gym_member_user');
                setToken('');
                setMember(null);
                setLoginError('Session expired — log in again to continue.');
            } else {
                setError(err.response?.data?.error || 'Failed to load your profile.');
            }
        }
    };

    useEffect(() => { fetchMe(); }, [token]);

    useEffect(() => {
        if (data?.qr_payload) {
            QRCode.toDataURL(data.qr_payload, { width: 240, margin: 1, errorCorrectionLevel: 'M' })
                .then(setQrUrl)
                .catch(() => setQrUrl(''));
        }
    }, [data?.qr_payload]);

    const handleLogin = async () => {
        if (!form.member_code.trim() || !form.password) {
            setLoginError('Enter your Member ID and password.');
            return;
        }
        setLoginError('');
        setLoginLoading(true);
        log('MemberPortal', 'handleLogin', `→ member login for member_code="${form.member_code}"`);
        try {
            const res = await api.post('/member/login', {
                member_code: form.member_code.trim(), password: form.password,
            });
            acceptSession(res.data);
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Login failed. Try again.');
            // Never retain a rejected password — the member retypes it, the
            // same as every banking app.
            setForm(f => ({ ...f, password: '' }));
            secretRef.current?.focus();
        } finally {
            setLoginLoading(false);
        }
    };

    // Both password paths share these checks, so the member hears about a
    // typo in the confirmation before anything is sent anywhere.
    const validateNewPassword = () => {
        if (form.new_password.length < 6) {
            setLoginError('Choose a password of at least 6 characters.');
            return false;
        }
        if (form.new_password !== form.confirm) {
            setLoginError('The two passwords do not match.');
            return false;
        }
        return true;
    };

    const handleChangePassword = async () => {
        if (!form.member_code.trim() || !form.current_password) {
            setLoginError('Enter your Member ID and your current password.');
            return;
        }
        if (!validateNewPassword()) return;
        setLoginError('');
        setLoginLoading(true);
        try {
            const res = await api.post('/member/change-password', {
                member_code: form.member_code.trim(),
                current_password: form.current_password,
                new_password: form.new_password,
            });
            acceptSession(res.data);
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Could not change your password. Try again.');
            setForm(f => ({ ...f, current_password: '', new_password: '', confirm: '' }));
        } finally {
            setLoginLoading(false);
        }
    };

    // Step 1 of the reset: find out where an OTP can be sent. The reply is the
    // same shape for an unknown Member ID, so this cannot be used to fish for
    // which IDs exist — an ID with nothing on file simply offers no options.
    const loadRecovery = async () => {
        if (!form.member_code.trim()) {
            setLoginError('Enter your Member ID.');
            return;
        }
        setLoginError('');
        setLoginLoading(true);
        try {
            const res = await api.get('/member/recovery-options', {
                params: { member_code: form.member_code.trim() },
            });
            setRecovery(res.data);
            if (!res.data.email && !res.data.phone) {
                setLoginError('We have no phone or email on file for that Member ID. '
                    + 'Ask the front desk to add one, or to reset your password for you.');
            }
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Could not look that Member ID up.');
        } finally {
            setLoginLoading(false);
        }
    };

    const sendOtp = async (method) => {
        setLoginError('');
        setLoginLoading(true);
        try {
            const res = await api.post('/member/forgot', {
                member_code: form.member_code.trim(), method,
            });
            setForgotStep('otp');
            setResendIn(res.data.resend_after_seconds || 0);
            // Only ever set by the development console gateway; in production
            // the OTP goes to the member and this stays empty.
            setDevOtp(res.data.dev_otp || '');
            setMessage('');
            setLoginError('');
            setRecovery(r => ({ ...r, sent_to: res.data.sent_to, method: res.data.method }));
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Could not send the OTP.');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleVerifyOtp = async () => {
        if (!form.otp.trim()) {
            setLoginError('Enter the OTP we sent you.');
            return;
        }
        if (!validateNewPassword()) return;
        setLoginError('');
        setLoginLoading(true);
        try {
            await api.post('/member/verify-otp', {
                member_code: form.member_code.trim(),
                otp: form.otp.trim(),
                new_password: form.new_password,
            });
            // Straight back to sign-in with the ID prefilled — they have just
            // chosen the password, so making them type it once proves it stuck.
            setMode('signin');
            setForgotStep('choose');
            setRecovery(null);
            setDevOtp('');
            setForm(f => ({ ...f, otp: '', new_password: '', confirm: '', password: '' }));
            setLoginError('');
            setMessage('Password reset. Sign in with your new password.');
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Could not reset your password.');
            // A wrong OTP must not silently keep the typed password around.
            setForm(f => ({ ...f, otp: '' }));
        } finally {
            setLoginLoading(false);
        }
    };

    // One shared countdown for the resend ladder: the wait after each OTP gets
    // longer, and the member can see exactly how long it is.
    useEffect(() => {
        if (resendIn <= 0) return undefined;
        const t = setTimeout(() => setResendIn(n => n - 1), 1000);
        return () => clearTimeout(t);
    }, [resendIn]);

    const openChangeDialog = () => {
        setLoginError('');
        setForm(f => ({
            ...f,
            member_code: member?.member_code || f.member_code,
            current_password: '', new_password: '', confirm: '',
        }));
        setChangeOpen(true);
    };

    const changeFromPortal = async () => {
        if (!form.current_password) {
            setLoginError('Enter your current password.');
            return;
        }
        if (!validateNewPassword()) return;
        setLoginError('');
        setLoginLoading(true);
        try {
            const res = await api.post('/member/change-password', {
                member_code: member.member_code,
                current_password: form.current_password,
                new_password: form.new_password,
            });
            // The reply carries a fresh token, so accepting it swaps the
            // session in place instead of bouncing the member to the login
            // screen to type the password they just chose.
            acceptSession(res.data);
            setChangeOpen(false);
            fetchMe();
        } catch (err) {
            setLoginError(err.response?.data?.error || 'Could not change your password.');
            setForm(f => ({ ...f, current_password: '' }));
        } finally {
            setLoginLoading(false);
        }
    };

    const backToSignIn = () => {
        setMode('signin');
        setForgotStep('choose');
        setRecovery(null);
        setDevOtp('');
        setLoginError('');
        setForm(f => ({ ...f, password: '', current_password: '', new_password: '', confirm: '', otp: '' }));
    };

    const acceptSession = (payload) => {
        localStorage.setItem('gym_member_token', payload.token);
        localStorage.setItem('gym_member_user',
            JSON.stringify({ name: payload.name, member_code: payload.member_code }));
        setToken(payload.token);
        setMember({ name: payload.name, member_code: payload.member_code });
        setMode('signin');
        setForgotStep('choose');
        setRecovery(null);
        setDevOtp('');
        setLoginError('');
        setMessage(payload.message || '');
        setForm(f => ({
            ...f, password: '', current_password: '', new_password: '', confirm: '', otp: '',
        }));
    };

    // Loaded on demand: most visits never open this tab, and the summary walks
    // the member's whole referral history.
    useEffect(() => {
        if (tab !== TAB('refer') || !token || referral) return;
        api.get('/member/referrals')
            .then(res => setReferral(res.data))
            .catch(err => setInviteErr(err.response?.data?.error || 'Could not load your referrals.'));
    }, [tab, token, referral]);

    const shareLink = referral
        ? `${window.location.origin}/#/member?ref=${encodeURIComponent(referral.referral_code || '')}`
        : '';

    const copyCode = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard is blocked in some in-app browsers — the code is on
            // screen and selectable, so this is a convenience, not the feature.
            setCopied(false);
        }
    };

    const submitInvite = async () => {
        setInviteErr(''); setInviteMsg('');
        if (!inviteForm.referred_name.trim()) {
            setInviteErr("Enter your friend's name.");
            return;
        }
        // A name on its own cannot be matched to the person who walks in —
        // plenty of gyms have three members with the same one — so the reward
        // could never be credited to the right invitation.
        if (inviteForm.referred_phone.replace(/\D/g, '').length < 10) {
            setInviteErr("Enter your friend's 10-digit phone number — it's how the desk matches them when they arrive.");
            return;
        }
        try {
            const res = await api.post('/member/referrals', inviteForm);
            setInviteMsg(res.data.message || 'Invitation recorded.');
            setInviteForm({ referred_name: '', referred_phone: '' });
            setReferral(null);   // refetch so the new row and counts appear
        } catch (err) {
            setInviteErr(err.response?.data?.error || 'Could not record that invitation.');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('gym_member_token');
        localStorage.removeItem('gym_member_user');
        // Two members sharing a phone at the front desk should not inherit
        // each other's appearance; the choice lives on the account.
        resetTheme();
        setToken('');
        setMember(null);
        setData(null);
        setForm({
            member_code: '', password: '', current_password: '', new_password: '', confirm: '', otp: '',
        });
        setTab(0);
    };

    // Local calendar date, never toISOString(). toISOString() converts to UTC
    // first, so east of Greenwich a local midnight lands on the previous day:
    // in IST every date built that way came out 24 hours early.
    const isoOf = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const todayStr = () => isoOf(new Date());

    const today = todayStr();
    const todayCheckin = useMemo(() => (data?.attendance || []).find(a => String(a.date) === today), [data, today]);

    // Group helpers
    const workoutsByDay = useMemo(() => {
        const map = {};
        (data?.workouts || []).forEach(w => {
            const day = w.day || 'Custom';
            (map[day] = map[day] || []).push(w);
        });
        return map;
    }, [data]);

    const dietByMeal = useMemo(() => {
        const map = {};
        (data?.diet || []).forEach(d => {
            const meal = d.meal || 'Other';
            (map[meal] = map[meal] || []).push(d);
        });
        return map;
    }, [data]);

    const weightTrend = useMemo(() =>
        (data?.progress || []).filter(p => p.weight != null).slice().reverse().map(p => ({
            date: String(p.record_date).slice(5),
            weight: Number(p.weight),
        })), [data]);

    const latestProgress = data?.progress?.[0] || null;

    // How much of the membership is left, as a proportion of its whole term.
    // The bar used to be fed days_left clamped to 100, so every membership
    // longer than about three months sat pinned at full no matter how much of
    // it had been used up.
    // Personal training is sold by duration, like membership — so what the
    // member wants to see is which plan they are on and how long is left, not
    // a count of visits. Sessions still appear, but only as history.
    const ptPlan = useMemo(() => {
        const subs = data?.pt_subscriptions || [];
        if (subs.length === 0) return null;
        const live = subs.find(p => p.status === 'active') || subs[0];
        const expiry = live.expiry_date
            ? new Date(`${String(live.expiry_date).slice(0, 10)}T00:00:00`) : null;
        const start = live.start_date
            ? new Date(`${String(live.start_date).slice(0, 10)}T00:00:00`) : null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const daysLeft = expiry ? Math.max(0, Math.round((expiry - today) / 86400000)) : null;
        const totalDays = expiry && start ? Math.round((expiry - start) / 86400000) : null;
        const fee = Number(live.price || 0);
        return {
            ...live,
            daysLeft,
            totalDays,
            // A term that has run out is over whether or not anything got round
            // to changing its status — nothing sweeps these rows nightly.
            over: daysLeft === 0 || live.status !== 'active',
            pctLeft: totalDays > 0 ? Math.max(0, Math.min(100, (daysLeft / totalDays) * 100)) : null,
            // The fee for *this* term. Summing every plan the member has ever
            // bought under a heading that reads "your training plan" made a
            // third renewal look like a single enormous charge.
            fee,
            perMonth: totalDays > 0 ? fee / (totalDays / 30) : null,
            lifetimeFee: subs.reduce((n, p) => n + Number(p.price || 0), 0),
        };
    }, [data?.pt_subscriptions]);

    // The locker, in the same shape as the training plan: a thing that runs to
    // a date, at a charge, with the documents that paid for it.
    const locker = useMemo(() => {
        const l = data?.locker;
        if (!l) return null;
        const until = l.assigned_until
            ? new Date(`${String(l.assigned_until).slice(0, 10)}T00:00:00`) : null;
        const from = l.assigned_from
            ? new Date(`${String(l.assigned_from).slice(0, 10)}T00:00:00`) : null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const daysLeft = until ? Math.max(0, Math.round((until - today) / 86400000)) : null;
        const totalDays = until && from ? Math.round((until - from) / 86400000) : null;
        return {
            ...l,
            daysLeft,
            totalDays,
            over: daysLeft === 0,
            pctLeft: totalDays > 0 ? Math.max(0, Math.min(100, (daysLeft / totalDays) * 100)) : null,
        };
    }, [data?.locker]);

    const lockerPayments = useMemo(
        () => (data?.payments || []).filter(p => p.purpose === 'locker'),
        [data?.payments]);

    /** The invoice raised for a locker charge, matched on the day it was taken. */
    const lockerInvoices = useMemo(
        () => (data?.invoices || []).filter(i =>
            /locker/i.test(String(i.notes || ''))
            || (i.items || []).some(it => /locker/i.test(String(it.description || '')))),
        [data?.invoices]);

    /** How many days a training term runs — the number that makes its fee readable. */
    const termDays = (sub) => {
        if (!sub?.start_date || !sub?.expiry_date) return 0;
        const a = new Date(`${String(sub.start_date).slice(0, 10)}T00:00:00`);
        const b = new Date(`${String(sub.expiry_date).slice(0, 10)}T00:00:00`);
        return isNaN(a) || isNaN(b) ? 0 : Math.round((b - a) / 86400000);
    };


    // Personal training and lockers each have a tab of their own, with their
    // own charges and receipts. Repeating those rows here made the membership
    // ledger read as though the plan had cost far more than it did.
    const membershipPayments = useMemo(
        () => (data?.payments || []).filter(p => p.purpose !== 'pt' && p.purpose !== 'locker'),
        [data?.payments]);

    const paidToDate = useMemo(
        () => membershipPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
        [membershipPayments]);

    /** "3 years, 2 months" — how long they have been with the gym. */
    const membershipYears = useMemo(() => {
        if (!data?.join_date) return null;
        const joined = new Date(`${String(data.join_date).slice(0, 10)}T00:00:00`);
        if (isNaN(joined.getTime())) return null;
        const now = new Date();
        let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth());
        if (now.getDate() < joined.getDate()) months -= 1;
        if (months < 0) return null;
        if (months < 1) return 'Joined this month';
        const years = Math.floor(months / 12);
        const rest = months % 12;
        const parts = [];
        if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
        if (rest) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);
        return `${parts.join(', ')} with us`;
    }, [data?.join_date]);

    const openReceipt = (payment) => {
        setReceiptError('');
        // A personal-training payment names the subscription it bought, so the
        // receipt can print the training term and the trainer instead of the
        // membership the member happens to hold today.
        const subscription = payment.purpose === 'pt'
            ? (data.pt_subscriptions || []).find(s => s.id === payment.reference_id)
            : null;
        const opened = printReceipt(payment, data, brand, { subscription });
        if (!opened) {
            // A blocked pop-up is the browser's decision, not a failure the
            // member caused — say what to do about it.
            setReceiptError('Your browser blocked the receipt window. Allow pop-ups for this site and try again.');
        }
    };

    const openInvoice = (invoice) => {
        setReceiptError('');
        if (!printInvoice(invoice, brand)) {
            setReceiptError('Your browser blocked the invoice window. Allow pop-ups for this site and try again.');
        }
    };

    const membershipPct = useMemo(() => {
        if (!data?.membership_start || !data?.membership_expiry || data.days_left == null) return null;
        const start = new Date(`${data.membership_start}T00:00:00`);
        const end = new Date(`${data.membership_expiry}T00:00:00`);
        const totalDays = (end - start) / 86400000;
        if (!(totalDays > 0)) return null;
        return Math.max(0, Math.min(100, (data.days_left / totalDays) * 100));
    }, [data?.membership_start, data?.membership_expiry, data?.days_left]);

    // Visits in the current calendar month, and the last 30 days as a strip.
    // Both read the same attendance rows the Visits tab shows, so the hero can
    // never disagree with the detail.
    const visitsThisMonth = useMemo(
        () => (data?.attendance || []).filter(a => String(a.date).slice(0, 7) === today.slice(0, 7)).length,
        [data, today]);

    // 30 cells, oldest first. A set lookup rather than a scan per cell: the
    // attendance list is small but this renders on every theme change.
    const visitStrip = useMemo(() => {
        const days = new Set((data?.attendance || []).map(a => String(a.date)));
        const out = [];
        const cursor = new Date(`${today}T00:00:00`);
        for (let i = 29; i >= 0; i--) {
            const d = new Date(cursor);
            d.setDate(cursor.getDate() - i);
            // Was d.toISOString().slice(0, 10) — which shifted the whole strip
            // one day back in any timezone ahead of UTC, so the last cell was
            // yesterday and no cell ever matched today. Invisible while the
            // cells were bare 14px squares; obvious once they print the date.
            const iso = isoOf(d);
            out.push({ iso, went: days.has(iso) });
        }
        return out;
    }, [data, today]);

    // The month tile read "4" with no month named anywhere on the card, so it
    // scanned as "month 4" — an index rather than September.
    const monthLabel = useMemo(
        () => new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', { month: 'long' }),
        [today]);

    // The strip crosses a month boundary, so a row of bare day numbers is
    // ambiguous: the 3 on the left and the 3 on the right are different days.
    // Each month gets a label spanning exactly the columns it owns. A run of
    // one or two days has no room for one and gets a spacer instead.
    const stripMonths = useMemo(() => {
        const runs = [];
        for (const d of visitStrip) {
            const key = d.iso.slice(0, 7);
            const last = runs[runs.length - 1];
            if (last && last.key === key) last.span += 1;
            else runs.push({
                key, span: 1,
                label: new Date(`${d.iso}T00:00:00`)
                    .toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
            });
        }
        return runs;
    }, [visitStrip]);

    // A bare date does not say whether that visit was yesterday or in the
    // spring, which is the only thing a member wants from it.
    const lastVisitAgo = useMemo(() => {
        const last = data?.attendance?.[0]?.date;
        if (!last) return '';
        const days = Math.round((new Date(`${today}T00:00:00`)
            - new Date(`${String(last).slice(0, 10)}T00:00:00`)) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        return `${days} days ago`;
    }, [data, today]);

    // ---- login screen -------------------------------------------------------
    // Three modes behind one card: sign in, change your password, or reset it
    // by OTP. All three are reachable without a session on purpose — the member
    // who most needs the last two is the one who cannot get in.
    const MODE_COPY = {
        signin: 'Sign in with your Member ID and your password.',
        change: 'Prove your current password, then pick a new one. Everyone starts on the '
            + 'password the gym gives out, so this is worth doing once.',
        forgot: 'We will send a one-time code to the phone number or email the gym has on file.',
    };

    const memberIdField = (onEnter) => (
        <TextField fullWidth label="Member ID" value={form.member_code}
            onChange={e => setForm({ ...form, member_code: e.target.value.replace(/\D/g, '') })}
            inputProps={{ inputMode: 'numeric' }}
            onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
            InputProps={{ startAdornment: <Badge color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
    );

    const newPasswordFields = (onEnter) => (
        <>
            <TextField fullWidth label="New password (min 6)" type="password"
                value={form.new_password} autoComplete="new-password"
                onChange={e => setForm({ ...form, new_password: e.target.value })}
                InputProps={{ startAdornment: <Key color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
            <TextField fullWidth label="Confirm new password" type="password"
                value={form.confirm} autoComplete="new-password"
                onChange={e => setForm({ ...form, confirm: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') onEnter(); }}
                InputProps={{ startAdornment: <Key color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
        </>
    );

    if (!token || !member) {
        return shell(
            <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                p: { xs: 2, sm: 3 }, ...signInGround(onInk, brand.colour) }}>
                {/* The same split card the staff door uses. This screen was a
                    small plain box on a flat diagonal: no rail, and — the thing
                    Gaurav noticed — no room for the gym's own line, which the
                    staff screen has carried all along. A member seeing the
                    portal for the first time got less of the gym than an
                    employee did. */}
                <Paper elevation={0} sx={{ ...signInCard(onInk), maxWidth: 880, width: '100%' }}>
                    <Grid container>
                        <Grid item xs={12} md={5}>
                            <Box sx={{ ...signInRail(brand.colour), p: { xs: 3.5, md: 5 },
                                display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                <Box sx={signInRailInner}>
                                    <Box sx={{ width: 52, height: 52, borderRadius: '16px',
                                        bgcolor: 'rgba(255,255,255,0.16)',
                                        border: '1px solid rgba(255,255,255,0.22)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 28, mb: 2.5 }}>
                                        {brand.logo}
                                    </Box>
                                    <Typography sx={{ fontSize: { xs: 26, md: 32 }, fontWeight: 900,
                                        letterSpacing: '-0.03em', lineHeight: 1.1, textWrap: 'balance' }}>
                                        {brand.name}
                                    </Typography>
                                    <Typography sx={{ mt: 1, fontSize: 12, fontWeight: 700,
                                        letterSpacing: '0.16em', textTransform: 'uppercase',
                                        color: 'rgba(255,255,255,0.82)' }}>
                                        Member portal
                                    </Typography>
                                    {brand.quote && (
                                        <>
                                            <Box sx={signInRule(brand.colour)} />
                                            <Typography variant="body1" sx={signInQuote}>
                                                {brand.quote}
                                            </Typography>
                                        </>
                                    )}
                                </Box>
                            </Box>
                        </Grid>

                        <Grid item xs={12} md={7}>
                            <Box sx={{ p: { xs: 3.5, md: 5 }, height: '100%',
                                display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <Typography sx={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em',
                        lineHeight: 1.15, mb: 0.75 }}>
                        {mode === 'signin' ? 'Welcome back' : mode === 'change' ? 'Change your password' : 'Reset your password'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" mb={2.5}>
                        {MODE_COPY[mode]}
                    </Typography>
                    <Alerts items={[
                        loginError && { severity: 'error', text: loginError },
                        mode === 'signin' && message && { severity: 'success', text: message },
                    ]} />

                    {mode === 'signin' && (
                        <Stack spacing={2}>
                            {memberIdField()}
                            <TextField fullWidth label="Password" type="password" value={form.password}
                                inputRef={secretRef} autoComplete="current-password"
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                                InputProps={{ startAdornment: <Lock color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
                            <Button variant="contained" size="large" onClick={handleLogin} disabled={loginLoading}>
                                {loginLoading ? 'Signing in…' : 'Sign in'}
                            </Button>
                            <Typography variant="caption" color="text.secondary" textAlign="center">
                                First time? Your password is the one the gym gave you.
                            </Typography>
                            <Divider flexItem />
                            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap">
                                <Button size="small" startIcon={<LockReset />}
                                    onClick={() => { setMode('change'); setLoginError(''); setMessage(''); }}>
                                    Change password
                                </Button>
                                <Button size="small" color="inherit"
                                    onClick={() => { setMode('forgot'); setLoginError(''); setMessage(''); }}>
                                    Forgot password?
                                </Button>
                            </Stack>
                        </Stack>
                    )}

                    {mode === 'change' && (
                        <Stack spacing={2}>
                            {memberIdField()}
                            <TextField fullWidth label="Current password" type="password"
                                value={form.current_password} autoComplete="current-password"
                                onChange={e => setForm({ ...form, current_password: e.target.value })}
                                InputProps={{ startAdornment: <Lock color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
                            {newPasswordFields(handleChangePassword)}
                            <Button variant="contained" size="large" onClick={handleChangePassword} disabled={loginLoading}>
                                {loginLoading ? 'Saving…' : 'Change password & sign in'}
                            </Button>
                            <Button size="small" startIcon={<ArrowBack />} onClick={backToSignIn}>
                                Back to sign in
                            </Button>
                        </Stack>
                    )}

                    {mode === 'forgot' && forgotStep === 'choose' && (
                        <Stack spacing={2}>
                            {memberIdField(loadRecovery)}
                            {!recovery ? (
                                <Button variant="contained" size="large" onClick={loadRecovery} disabled={loginLoading}>
                                    {loginLoading ? 'Checking…' : 'Continue'}
                                </Button>
                            ) : (
                                <>
                                    <Typography variant="caption" color="text.secondary">
                                        Where should we send the code?
                                    </Typography>
                                    <Button variant="outlined" size="large" startIcon={<Sms />}
                                        disabled={!recovery.phone || loginLoading}
                                        onClick={() => sendOtp('sms')}>
                                        {recovery.phone ? `Text ${recovery.phone}` : 'No phone on file'}
                                    </Button>
                                    <Button variant="outlined" size="large" startIcon={<Email />}
                                        disabled={!recovery.email || loginLoading}
                                        onClick={() => sendOtp('email')}>
                                        {recovery.email ? `Email ${recovery.email}` : 'No email on file'}
                                    </Button>
                                </>
                            )}
                            <Button size="small" startIcon={<ArrowBack />} onClick={backToSignIn}>
                                Back to sign in
                            </Button>
                        </Stack>
                    )}

                    {mode === 'forgot' && forgotStep === 'otp' && (
                        <Stack spacing={2}>
                            <Alert severity="info">
                                Code sent to {recovery?.sent_to || 'your registered contact'}.
                                {devOtp && <> Development code: <strong>{devOtp}</strong></>}
                            </Alert>
                            <TextField fullWidth label="One-time code" value={form.otp}
                                onChange={e => setForm({ ...form, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                inputProps={{ inputMode: 'numeric', maxLength: 6 }}
                                InputProps={{ startAdornment: <Key color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
                            {newPasswordFields(handleVerifyOtp)}
                            <Button variant="contained" size="large" onClick={handleVerifyOtp} disabled={loginLoading}>
                                {loginLoading ? 'Resetting…' : 'Reset password'}
                            </Button>
                            {/* The wait grows with each resend, so show it counting
                                down rather than letting the member tap into a 429. */}
                            <Button size="small" disabled={resendIn > 0 || loginLoading}
                                onClick={() => sendOtp(recovery?.method || 'sms')}>
                                {resendIn > 0
                                    ? `Resend in ${Math.floor(resendIn / 60)}:${String(resendIn % 60).padStart(2, '0')}`
                                    : 'Resend code'}
                            </Button>
                            <Button size="small" startIcon={<ArrowBack />} onClick={backToSignIn}>
                                Back to sign in
                            </Button>
                        </Stack>
                    )}

                    <PoweredBy sx={{ pt: 2.5, pb: 0 }} />
                            </Box>
                        </Grid>
                    </Grid>
                </Paper>
            </Box>
        );
    }

    if (!data) {
        return shell(
            <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: 'background.default' }}>
                <CircularProgress />
            </Box>
        );
    }

    const expiryChip = data.expired
        ? <Chip size="small" label={`Expired ${fmtDate(data.membership_expiry)}`} color="error" />
        : data.expiring
            ? <Chip size="small" label={`Expires in ${data.days_left} day${data.days_left === 1 ? '' : 's'}`} color="warning" />
            : <Chip size="small" label={data.days_left != null ? `${data.days_left} days left` : 'Active'} color="success" />;

    // Filled rather than outlined when something is owed: there is no
    // instalment plan in this product, so an unpaid balance is not a status,
    // it is the reason the door will not open.
    const dueChip = data.amount_due > 0
        ? <Chip size="small" label={`${fmtMoney(data.amount_due)} due`} color="error" />
        : <Chip size="small" label="Paid in full" color="success" variant="outlined" />;

    return shell(
        <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
            {/* Header — one band, two clear tiers: the gym above, the member
                below. Previously these were two competing left-aligned blocks
                with a void to their right, so neither read as the subject. */}
            <Box sx={{
                // One continuous sheet. This band used to be a teal gradient
                // sitting on a grey body — the seam that made the portal read
                // as two unrelated designs stacked. It now shares the page's
                // ground and is separated by a line, not a colour change.
                background: T.heroBg,
                color: onInk ? '#fff' : T.text,
                borderBottom: onInk ? 'none' : `1px solid ${T.line}`,
            }}>
                {/* Tier 1 — whose gym this is, and the way out. */}
                <Box
                    sx={{
                        px: { xs: 2, md: 4 }, py: 1.25,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                        borderBottom: `1px solid ${onInk ? 'rgba(148,163,184,0.18)' : T.line}`,
                    }}
                >
                    <Box display="flex" alignItems="center" gap={1.25} sx={{ minWidth: 0 }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: 1.5, bgcolor: 'rgba(16,185,129,0.9)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                            {brand.logo}
                        </Box>
                        <Typography noWrap sx={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.01em' }}>
                            {brand.name}
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: T.textDim, display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}
                        >
                            · Member portal
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        <ThemeToggle mode={themeMode} onToggle={toggleTheme} tone={onInk ? 'onDark' : 'default'} />
                        <Button size="small" variant="text"
                            sx={{ color: onInk ? '#cbd5e1' : T.textDim,
                                '&:hover': { bgcolor: onInk ? 'rgba(148,163,184,0.12)' : 'action.hover' } }}
                            startIcon={<Logout />} onClick={handleLogout}>
                            Log out
                        </Button>
                    </Box>
                </Box>

                {/* Tier 2 — the member. Their name is the subject of the page,
                    and their status sits with it rather than adrift on the right. */}
                <Box sx={{ px: { xs: 2, md: 4 }, pt: { xs: 2, md: 2.5 }, pb: { xs: 2, md: 2.5 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                        {/* The avatar wears the term. The same fact used to be
                            an 8px bar and a 12px caption further down the page —
                            the least motivating presentation of the single most
                            motivating number in the product. */}
                        <Ring
                            size={64}
                            pct={data.expired ? 0 : (membershipPct == null ? 0 : membershipPct)}
                            color={data.expired ? T.danger : (data.expiring ? T.warn : T.accent)}
                            track={T.track}
                            title={data.days_left != null
                                ? `${data.days_left} days left of your membership`
                                : 'Membership term'}
                        >
                            <Avatar sx={{ bgcolor: T.accent, color: onInk ? '#04140E' : '#fff',
                                width: 48, height: 48, fontWeight: 800, fontSize: 17 }}>
                                {member.name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                            </Avatar>
                        </Ring>

                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                            <Typography sx={{
                                fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1.05,
                                fontSize: 'clamp(1.5rem, 6.5vw, 2.25rem)',
                            }} noWrap>
                                Hi {member.name.split(' ')[0]} 👋
                            </Typography>
                            <Typography sx={{
                                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                                fontSize: 11, letterSpacing: '0.16em', color: T.textDim, mt: 0.25,
                            }}>
                                MEMBER {member.member_code}
                            </Typography>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                            {expiryChip}
                            {dueChip}
                        </Box>
                    </Box>

                    {/* The three facts a member opens this app for: am I in,
                        have I been, do I owe anything. */}
                    <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                        <Stat label="Days left" tone={data.expired ? T.danger : T.accent}>
                            <Figure value={data.expired ? 0 : (data.days_left ?? 0)} />
                        </Stat>
                        {/* "This month · 4" names a period and a bare number, and
                            leaves the member to guess the noun. Its two neighbours
                            both carry their unit; this one has to as well. */}
                        <Stat label="Visits this month">
                            <Figure value={visitsThisMonth} />
                        </Stat>
                        <Stat label="Due" tone={data.amount_due > 0 ? T.danger : undefined}>
                            <Figure value={Number(data.amount_due) || 0}
                                format={(n) => `₹${n.toLocaleString('en-IN')}`} />
                        </Stat>
                    </Box>
                </Box>
            </Box>

            {/* Alerts */}
            <Box sx={{ px: { xs: 2, md: 4 }, pt: 2 }}>
                {data.expired && (
                    <Alert severity="error" sx={{ mb: 2 }} icon={<Info />}>
                        Your membership expired on {fmtDate(data.membership_expiry)}. Please renew at the front desk —
                        your check-in is paused until then.
                    </Alert>
                )}
                {data.expiring && !data.expired && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        Your membership expires on {fmtDate(data.membership_expiry)} ({data.days_left} days). Renew soon to keep your access uninterrupted.
                    </Alert>
                )}
                {data.amount_due > 0 && (
                    <Alert severity="error" sx={{ mb: 2 }} icon={<Lock />}>
                        <strong>{fmtMoney(data.amount_due)} outstanding.</strong> Your fingerprint, card and
                        QR check-in stay locked until the balance is cleared — the gym does not run
                        instalments. Pay at the front desk to restore access.
                    </Alert>
                )}
                {/* Everyone starts on the same password, so until a member
                    changes it, anyone who has seen their Member ID can open
                    this page. Say so plainly rather than hoping they notice. */}
                {data.password_is_default && (
                    <Alert
                        severity="warning"
                        sx={{ mb: 2 }}
                        icon={<LockReset />}
                        action={
                            <Button color="inherit" size="small" onClick={openChangeDialog}
                                sx={{ whiteSpace: 'nowrap' }}>
                                Change it
                            </Button>
                        }
                    >
                        You are still using the password the gym gives every member. Anyone who knows
                        your Member ID can see this page until you change it.
                    </Alert>
                )}
                <Alerts items={[
                    message && { severity: 'success', text: message },
                    error && { severity: 'error', text: error },
                ]} />
            </Box>

            {/* Navigation — every module visible, at every width.

                This was a single `<Tabs variant="scrollable">` strip. Measured
                on a 390px phone it showed TWO of the ten destinations; the
                other eight were off-screen behind a horizontal scroll with no
                affordance saying so, and the Progress tab auto-scrolled far
                enough that Overview disappeared entirely. Even 1440px clipped
                one. A member cannot use what they cannot see, so the strip is
                gone: ModuleNav wraps instead of scrolling, which is the only
                layout that survives a tab count that changes per member. */}
            <Box sx={{ px: { xs: 2, md: 4 } }}>
                <Box sx={{ mb: 2 }}>
                    <ModuleNav
                        items={navItems}
                        value={tabsFor(hasPt, hasLocker)[tab]}
                        onChange={(key) => setTab(TAB(key))}
                        tone={themeMode === 'dark' ? 'dark' : 'light'}
                        ariaLabel="Member sections"
                    />
                </Box>

                {/* ---- Overview ---- */}
                <TabPanel value={tab} index={TAB('overview')}>
                    <Grid container spacing={2}>
                        {/* Membership */}
                        <Grid item xs={12} md={4}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Typography variant="overline" color="text.secondary">Membership</Typography>
                                    <Typography variant="h5" fontWeight={800} mb={0.5}>{data.membership_type || '—'}</Typography>
                                    <Stack spacing={0.5} mt={1}>
                                        <Box display="flex" justifyContent="space-between">
                                            <Typography variant="body2" color="text.secondary">Started</Typography>
                                            <Typography variant="body2" fontWeight={600}>{fmtDate(data.membership_start)}</Typography>
                                        </Box>
                                        <Box display="flex" justifyContent="space-between">
                                            <Typography variant="body2" color="text.secondary">Valid until</Typography>
                                            <Typography variant="body2" fontWeight={600}>{fmtDate(data.membership_expiry)}</Typography>
                                        </Box>
                                        {/* Only when there is one. "Trainer —" was a
                                            row of nothing for most members, and the
                                            ones who do have a trainer now get a whole
                                            tab of it. */}
                                        {hasTrainer && (
                                            <Box display="flex" justifyContent="space-between">
                                                <Typography variant="body2" color="text.secondary">Trainer</Typography>
                                                <Typography variant="body2" fontWeight={600}>{data.trainer.name}</Typography>
                                            </Box>
                                        )}
                                    </Stack>
                                    {data.days_left != null && !data.expired && membershipPct != null && (
                                        <>
                                            <LinearProgress variant="determinate" sx={{ mt: 2, mb: 0.5, height: 8, borderRadius: 4 }}
                                                value={membershipPct} color={data.expiring ? 'warning' : 'success'} />
                                            <Typography variant="caption" color="text.secondary">
                                                {data.days_left} days remaining · {Math.round(membershipPct)}% of your term
                                            </Typography>
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* Dues */}
                        <Grid item xs={12} md={4}>
                            <Card sx={{ height: '100%', border: data.amount_due > 0 ? '1px solid' : 'none', borderColor: 'error.main' }}>
                                <CardContent>
                                    <Typography variant="overline" color="text.secondary">Billing</Typography>
                                    <Typography variant="h5" fontWeight={800} mb={0.5}>{fmtMoney(data.membership_fee)}</Typography>
                                    <Stack spacing={0.5} mt={1}>
                                        <Box display="flex" justifyContent="space-between">
                                            <Typography variant="body2" color="text.secondary">Plan fee</Typography>
                                            <Typography variant="body2" fontWeight={600}>{fmtMoney(data.membership_fee)}</Typography>
                                        </Box>
                                        <Box display="flex" justifyContent="space-between">
                                            <Typography variant="body2" color="text.secondary">Paid</Typography>
                                            <Typography variant="body2" fontWeight={600} color="success.main">{fmtMoney(data.amount_paid)}</Typography>
                                        </Box>
                                        <Box display="flex" justifyContent="space-between">
                                            <Typography variant="body2" color="text.secondary">Due</Typography>
                                            <Typography variant="body2" fontWeight={800} color={data.amount_due > 0 ? 'error.main' : 'inherit'}>
                                                {fmtMoney(data.amount_due)}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                    {/* Membership money only. This card is headed by the plan
                                        fee, so a personal-training charge sitting under it read
                                        as part of what the membership cost. */}
                                    {membershipPayments.length > 0 && (
                                        <>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Typography variant="caption" color="text.secondary">Recent payments</Typography>
                                            {membershipPayments.slice(0, 3).map((p, i) => (
                                                <Box key={i} display="flex" justifyContent="space-between" mt={0.5}>
                                                    <Typography variant="body2">{fmtDate(p.payment_date)} · {p.method}</Typography>
                                                    <Typography variant="body2" fontWeight={600}>{fmtMoney(p.amount)}</Typography>
                                                </Box>
                                            ))}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* The gym pass — the one decorated object in the
                            product, and the only thing here that does not
                            follow the theme. It is what a member holds up at a
                            door, so it stays ink on either ground: a dark slab
                            on paper reads at least as well as a lit one on ink.

                            It is something to present, never a button. A self
                            check-in needs nothing but the member's own token,
                            so it could be tapped from the sofa and would prove
                            nothing about who was in the building. Only a staff
                            scan in the main app writes attendance. */}
                        <Grid item xs={12} md={4}>
                            <Box sx={{
                                height: '100%', borderRadius: 4, p: '1.5px',
                                background: PASS.edge, backgroundSize: '260% 260%',
                                '@media (prefers-reduced-motion: no-preference)': {
                                    animation: 'gymHolo 9s linear infinite',
                                },
                                '@keyframes gymHolo': { to: { backgroundPosition: '260% 0' } },
                            }}>
                                <Box sx={{
                                    height: '100%', borderRadius: '14px', background: PASS.face,
                                    color: PASS.text, textAlign: 'center', p: 2.5,
                                    position: 'relative', overflow: 'hidden',
                                    // The laminate catching the light. One element,
                                    // one sweep every 7s with a long rest, so it
                                    // reads as craft rather than noise.
                                    '&::after': {
                                        content: '""', position: 'absolute', top: '-60%', left: '-120%',
                                        width: '55%', height: '220%', pointerEvents: 'none',
                                        background: `linear-gradient(90deg,transparent,${PASS.sheen},transparent)`,
                                        transform: 'rotate(18deg)',
                                    },
                                    '@media (prefers-reduced-motion: no-preference)': {
                                        '&::after': { animation: 'gymSheen 7s cubic-bezier(0.4,0,0.2,1) infinite' },
                                    },
                                    '@keyframes gymSheen': {
                                        '0%, 72%': { left: '-120%' },
                                        '100%': { left: '170%' },
                                    },
                                }}>
                                    <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.24em',
                                        textTransform: 'uppercase', color: PASS.dim }}>
                                        Your gym pass
                                    </Typography>

                                    {/* The face follows the theme; the plate does
                                        not. A desk scanner needs the quiet zone,
                                        so it is white on either ground — with a
                                        hairline on paper so it still reads as an
                                        object and not a hole in the card. */}
                                    <Box display="flex" justifyContent="center" my={1.5}
                                        sx={{ opacity: data.expired ? 0.35 : 1, transition: 'opacity 150ms' }}>
                                        {qrUrl
                                            ? <Box sx={{ bgcolor: PASS.plate, p: 1, borderRadius: 2,
                                                border: PASS.plateEdge, boxShadow: PASS.glow, lineHeight: 0 }}>
                                                <img src={qrUrl} alt={`Gym pass QR code for member ${data.member_code}`}
                                                    style={{ width: 168, height: 168, display: 'block' }} />
                                              </Box>
                                            : <CircularProgress size={48} />}
                                    </Box>

                                    <Typography sx={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.01em' }}>
                                        {member.name}
                                    </Typography>
                                    {/* Set like a card number, because that is
                                        what it is at the door. */}
                                    <Typography sx={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                                        fontSize: 12, letterSpacing: '0.26em', color: PASS.code, mt: 0.25 }}>
                                        {data.member_code}
                                    </Typography>

                                    <Typography sx={{ fontSize: 12, color: PASS.dim, mt: 1.25, lineHeight: 1.45 }}>
                                        <StorefrontOutlined fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                                        {data.expired
                                            ? 'Renew your membership to start checking in again.'
                                            : 'Show this at the front desk — staff scan it to mark you in.'}
                                    </Typography>

                                    <Box sx={{ borderTop: '1px solid rgba(148,163,184,0.18)', mt: 1.5, pt: 1.25 }}>
                                        {todayCheckin ? (
                                            <Typography sx={{ fontSize: 13, fontWeight: 700, color: PASS.code }}>
                                                <CheckCircle fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                                                Checked in today at {fmtTime(todayCheckin.time)}
                                            </Typography>
                                        ) : (
                                            <Typography sx={{ fontSize: 13, color: PASS.dim }}>
                                                <Schedule fontSize="inherit" sx={{ verticalAlign: 'middle', mr: 0.5 }} />
                                                Not checked in yet today
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        </Grid>

                        {/* Attendance — the one number in this product the
                            member actually controls, and the only one the gym
                            can prove: a staff scan, never a self check-in. */}
                        <Grid item xs={12}>
                            <Card>
                                <CardContent>
                                    {/* Title and its gloss travel together. Held apart by
                                        space-between they sat at opposite ends of a 1650px
                                        card, and the caption stopped reading as a caption
                                        for anything. */}
                                    <Box display="flex" alignItems="baseline" flexWrap="wrap" gap={1.5}>
                                        <Typography variant="overline" color="text.secondary">Your visits</Typography>
                                        {/* The right of this line used to carry a second count of the
                                            same thing ("last 30 days - 10 visits") while a tile below
                                            said 12. Two numbers for one question is how the card lost
                                            the reader. It now says what the squares ARE; the counting
                                            happens once, in the tiles. */}
                                        <Typography variant="caption" color="text.secondary">
                                            one square per day, oldest first
                                        </Typography>
                                    </Box>

{/* One cell per day, oldest on the left. A run of lit cells is a
                                        habit; a gap is a fortnight off. Neither reads from a count on
                                        its own.

                                        The strip was capped at 14px a cell to stop it reading as an
                                        unlabelled bar chart on a wide screen. Gaurav asked for the
                                        opposite - the full width of the card, so a day can be picked
                                        out at a glance. Full width buys the room to print the date IN
                                        the cell, which is what makes a particular day findable; the
                                        cap existed because 50px of bare colour said nothing. */}
                                    <Box sx={{ mt: 2 }}>
                                        <Box sx={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(30, minmax(0, 1fr))',
                                            gap: { xs: '3px', sm: '4px', md: '6px' },
                                        }}>
                                            {visitStrip.map((d) => {
                                                const isToday = d.iso === today;
                                                return (
                                                    <Box
                                                        key={d.iso}
                                                        title={`${fmtDate(d.iso)} - ${d.went ? 'you trained' : 'no check-in'}`}
                                                        sx={{
                                                            height: { xs: 18, sm: 34, md: 46 },
                                                            borderRadius: { xs: '3px', sm: '8px' },
                                                            bgcolor: d.went ? T.accent : T.track,
                                                            opacity: d.went ? 1 : 0.55,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            /* Today is the one cell a member looks for first. An
                                                               accent ring would vanish on a day they trained, so
                                                               the ring is drawn in the card's own foreground. */
                                                            outline: isToday ? `2px solid ${onInk ? 'rgba(255,255,255,0.65)' : 'rgba(15,23,42,0.5)'}` : 'none',
                                                            outlineOffset: '2px',
                                                        }}
                                                    >
                                                        {/* Below sm the cell is 18px tall and the number would not
                                                            fit; there the strip falls back to bare colour. */}
                                                        <Typography sx={{
                                                            display: { xs: 'none', sm: 'block' },
                                                            fontSize: { sm: 11, md: 13 }, fontWeight: 700, lineHeight: 1,
                                                            color: d.went ? (onInk ? '#04140E' : '#FFFFFF') : T.dim,
                                                        }}>
                                                            {Number(d.iso.slice(8, 10))}
                                                        </Typography>
                                                    </Box>
                                                );
                                            })}
                                        </Box>

                                        {/* The month axis shares the strip's 30 columns, so each label sits
                                            under the days it actually names. */}
                                        <Box sx={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(30, minmax(0, 1fr))',
                                            gap: { xs: '3px', sm: '4px', md: '6px' },
                                            mt: 0.75,
                                        }}>
                                            {stripMonths.map((m) => (
                                                <Typography
                                                    key={m.key}
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ gridColumn: `span ${m.span}`, minWidth: 0, whiteSpace: 'nowrap' }}
                                                >
                                                    {m.span >= 3 ? m.label : ''}
                                                </Typography>
                                            ))}
                                        </Box>
                                    </Box>

                                    {/* Green against grey means nothing without a key - the first
                                        question anyone asked of this strip was what the two colours
                                        were. */}
                                    <Box sx={{
                                        display: 'flex', alignItems: 'center', gap: 2,
                                        flexWrap: 'wrap', mt: 1.5, mb: 2.5,
                                    }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: T.accent }} />
                                            <Typography variant="caption" color="text.secondary">you trained</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: T.track, opacity: 0.55 }} />
                                            {/* "rest day" asserted something the data cannot know. A blank
                                                square is equally a day the gym was shut, a day trained
                                                elsewhere, or a day before this member joined. */}
                                            <Typography variant="caption" color="text.secondary">no check-in</Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: T.track, opacity: 0.55,
                                                outline: `2px solid ${onInk ? 'rgba(255,255,255,0.65)' : 'rgba(15,23,42,0.5)'}`,
                                                outlineOffset: '1.5px' }} />
                                            <Typography variant="caption" color="text.secondary">today</Typography>
                                        </Box>
                                    </Box>

                                    <Box display="flex" gap={3} flexWrap="wrap">
                                        <Box>
                                            {/* This tile used to show data.attendance.length under the
                                                label "recent check-ins". That list is capped at the 30
                                                most recent rows over any date range, so the figure was
                                                neither a lifetime total nor the strip's window - it
                                                printed 12 beneath a strip that counted 10, and named no
                                                window that would explain the gap. Counting the strip
                                                itself means the number and the squares cannot disagree. */}
                                            <Figure value={visitStrip.filter(d => d.went).length}
                                                sx={{ fontSize: '1.75rem', color: 'primary.main' }} />
                                            <Typography variant="caption" color="text.secondary">in the last 30 days</Typography>
                                        </Box>
                                        <Box>
                                            <Figure value={visitsThisMonth}
                                                sx={{ fontSize: '1.75rem', color: 'primary.main' }} />
                                            <Typography variant="caption" color="text.secondary">in {monthLabel}</Typography>
                                        </Box>
                                        <Box>
                                            <Typography sx={{ fontSize: '1.75rem', fontWeight: 900, letterSpacing: '-0.035em',
                                                lineHeight: 1.1, color: 'text.secondary' }}>
                                                {data.attendance?.[0] ? fmtDate(data.attendance[0].date) : '\u2014'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {lastVisitAgo ? `last visit \u00b7 ${lastVisitAgo}` : 'last visit'}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </TabPanel>

                {/* ---- Classes ---- */}
                <TabPanel value={tab} index={TAB('classes')}>
                    {data.expired ? (
                        <Alert severity="error">Bookings are unavailable while your membership is expired — renew at the front desk first.</Alert>
                    ) : (
                        <MemberClassGrid />
                    )}
                </TabPanel>

                {/* ---- Workouts ---- */}
                <TabPanel value={tab} index={TAB('workouts')}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <FitnessCenter sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Your Workout Plan</Typography>
                        </Box>
                        {(data.workouts || []).length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                                No workout plan assigned yet — ask your trainer.
                            </Typography>
                        ) : (
                            <PlanGrid>
                                {DAYS.filter(d => workoutsByDay[d]).map(day => (
                                    <Card variant="outlined" key={day}>
                                            <CardContent sx={{ pb: 2 }}>
                                                <PlanHead title={day}
                                                    summary={`${workoutsByDay[day].length} ${workoutsByDay[day].length === 1 ? 'move' : 'moves'}`} />
                                                {workoutsByDay[day].map((w, i) => (
                                                    <PlanRow
                                                        key={i} divider={i > 0} rail={T.lineStrong}
                                                        title={w.exercise}
                                                        metrics={[
                                                            (w.sets || w.reps) && { value: `${w.sets || '—'}×${w.reps || '—'}`, label: 'sets × reps' },
                                                            w.weight && { value: `${w.weight}`, label: 'kg' },
                                                            w.rest_seconds && { value: `${w.rest_seconds}s`, label: 'rest' },
                                                        ].filter(Boolean)}
                                                        note={w.notes}
                                                    />
                                                ))}
                                        </CardContent>
                                    </Card>
                                ))}
                            </PlanGrid>
                        )}
                    </Paper>
                </TabPanel>

                {/* ---- Diet ---- */}
                <TabPanel value={tab} index={TAB('diet')}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <Restaurant sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Your Diet Plan</Typography>
                        </Box>
                        {(data.diet || []).length === 0 ? (
                            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                                No diet plan assigned yet — ask your trainer.
                            </Typography>
                        ) : (
                            <PlanGrid>
                                {MEALS.filter(m => dietByMeal[m]).map(meal => {
                                    // Per-item calories were already shown; what the member actually
                                    // asks is what the whole meal comes to.
                                    const mealKcal = dietByMeal[meal]
                                        .reduce((sum, d) => sum + (Number(d.calories) || 0), 0);
                                    return (
                                    <Card variant="outlined" key={meal}>
                                            <CardContent sx={{ pb: 2 }}>
                                                <PlanHead title={meal}
                                                    summary={mealKcal > 0 ? `${mealKcal.toLocaleString('en-IN')} kcal` : null} />
                                                {dietByMeal[meal].map((d, i) => (
                                                    <PlanRow
                                                        key={i} divider={i > 0} rail={T.lineStrong}
                                                        title={d.food_item}
                                                        trailing={d.calories != null ? (
                                                            <Typography component="div" color="text.secondary" sx={{
                                                                fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                                                                fontVariantNumeric: 'tabular-nums',
                                                            }}>{d.calories} kcal</Typography>
                                                        ) : null}
                                                        metrics={[
                                                            d.protein_g != null && { value: `${d.protein_g}g`, label: 'protein' },
                                                            d.carbs_g != null && { value: `${d.carbs_g}g`, label: 'carbs' },
                                                            d.fats_g != null && { value: `${d.fats_g}g`, label: 'fat' },
                                                        ].filter(Boolean)}
                                                    />
                                                ))}
                                        </CardContent>
                                    </Card>
                                    );
                                })}
                            </PlanGrid>
                        )}
                    </Paper>
                </TabPanel>

                {/* ---- Progress ---- */}
                <TabPanel value={tab} index={TAB('progress')}>
                    <Grid container spacing={2}>
                        {latestProgress && (
                            <Grid item xs={12} md={4}>
                                {/* height 100% to match the Weight trend card beside it. Without
                                    it this card ended 58px short and the row looked broken. */}
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="overline" color="text.secondary">Latest check-in</Typography>
                                        <Typography variant="h6" fontWeight={800} mb={1}>{fmtDate(latestProgress.record_date)}</Typography>
                                        <Stack spacing={0.5}>
                                            {[['Weight', latestProgress.weight, 'kg'], ['Body fat', latestProgress.body_fat, '%'],
                                              ['Chest', latestProgress.chest, 'cm'], ['Waist', latestProgress.waist, 'cm'],
                                              ['Arms', latestProgress.arms, 'cm'], ['Thighs', latestProgress.thighs, 'cm'],
                                              ['Shoulders', latestProgress.shoulders, 'cm']]
                                                .filter(([, v]) => v != null)
                                                .map(([label, v, unit]) => (
                                                    <Box key={label} display="flex" justifyContent="space-between">
                                                        <Typography variant="body2" color="text.secondary">{label}</Typography>
                                                        <Typography variant="body2" fontWeight={700}>{v} {unit}</Typography>
                                                    </Box>
                                                ))}
                                        </Stack>
                                        {latestProgress.notes && (
                                            <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                                                {latestProgress.notes}
                                            </Typography>
                                        )}
                                    </CardContent>
                                </Card>
                            </Grid>
                        )}
                        <Grid item xs={12} md={latestProgress ? 8 : 12}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                                        <TrendingUp sx={{ color: 'primary.main' }} />
                                        <Typography variant="h6">Weight trend</Typography>
                                    </Box>
                                    {weightTrend.length >= 2 ? (
                                        <ResponsiveContainer width="100%" height={280}>
                                            <LineChart data={weightTrend} margin={{ top: 5, right: 20, bottom: 5, left: -10 }}>
                                                {/* recharts reads nothing from the MUI theme: left alone it keeps a
                                                    light grid, #666 axis text and a white tooltip on an ink page. */}
                                                <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid} />
                                                <XAxis dataKey="date" tick={{ fontSize: 12, fill: T.chartAxis }}
                                                    stroke={T.chartGrid} />
                                                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12, fill: T.chartAxis }}
                                                    stroke={T.chartGrid} />
                                                <Tooltip
                                                    contentStyle={{ background: T.chartTipBg, border: `1px solid ${T.chartTipLine}`,
                                                        borderRadius: 10, fontSize: 13 }}
                                                    labelStyle={{ color: T.textDim }}
                                                    itemStyle={{ color: T.text }}
                                                    cursor={{ stroke: T.chartGrid }} />
                                                <Line type="monotone" dataKey="weight" stroke={T.accent} strokeWidth={2.5}
                                                    dot={{ r: 4, fill: T.accent }} name="Weight (kg)" />
                                            </LineChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <Typography variant="body2" color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                                            {weightTrend.length === 1
                                                ? 'Add more progress records to see your weight trend.'
                                                : 'No progress records yet — your trainer will add them.'}
                                        </Typography>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </TabPanel>

                {/* ---- Attendance ---- */}
                <TabPanel value={tab} index={TAB('attendance')}>
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1} mb={2}>
                            <FactCheck sx={{ color: 'primary.main' }} />
                            <Typography variant="h6">Your Attendance</Typography>
                        </Box>
                        {/* A four-column table at 390px hid two of its
                            columns behind a scroll shadow. Ledger keeps the
                            table on a wide screen and stacks it on a phone. */}
                        <Ledger
                            rows={data.attendance || []}
                            getKey={(a, i) => `${a.date}-${i}`}
                            empty="No attendance yet — check in with your QR code or fingerprint at the gym."
                            columns={[
                                { key: 'date', label: 'Date', render: (a) => (
                                    <Box display="flex" alignItems="center" gap={1}>
                                        {fmtDate(a.date)}
                                        {String(a.date) === today && <Chip size="small" label="Today" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                                    </Box>
                                ) },
                                { key: 'time', label: 'Time', render: (a) => fmtTime(a.time) },
                                { key: 'status', label: 'Status', render: (a) => (
                                    <Chip size="small" label={a.status}
                                        color={a.status === 'Present' ? 'success' : 'error'} />
                                ) },
                                { key: 'source', label: 'Method', render: (a) => (
                                    <Chip size="small" variant="outlined"
                                        label={a.source === 'device' ? 'Fingerprint' : a.source === 'qr' ? 'QR code' : 'Manual'} />
                                ) },
                            ]}
                            primary={(a) => (
                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                    {fmtDate(a.date)}
                                    {String(a.date) === today && <Chip size="small" label="Today" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
                                </Box>
                            )}
                            meta={(a) => `${fmtTime(a.time)} · ${a.source === 'device' ? 'Fingerprint' : a.source === 'qr' ? 'QR code' : 'Manual'}`}
                            value={(a) => (
                                <Chip size="small" label={a.status}
                                    color={a.status === 'Present' ? 'success' : 'error'} />
                            )}
                        />
                    </Paper>
                </TabPanel>

                {/* ---- Membership & payments ---- */}
                <TabPanel value={tab} index={TAB('payments')}>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                                        <HistoryEdu fontSize="small" sx={{ color: 'primary.main' }} />
                                        <Typography variant="overline" color="text.secondary">Member since</Typography>
                                    </Box>
                                    <Typography variant="h5" fontWeight={800}>{fmtDate(data.join_date)}</Typography>
                                    {membershipYears != null && (
                                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                                            {membershipYears}
                                        </Typography>
                                    )}
                                    <Divider sx={{ my: 2 }} />
                                    <Stack spacing={0.75}>
                                        {[
                                            ['Current plan', data.membership_type || '—'],
                                            ['Started', fmtDate(data.membership_start)],
                                            ['Valid until', fmtDate(data.membership_expiry)],
                                        ].map(([k, v]) => (
                                            <Box key={k} display="flex" justifyContent="space-between" gap={2}>
                                                <Typography variant="body2" color="text.secondary">{k}</Typography>
                                                <Typography variant="body2" fontWeight={600} textAlign="right">{v}</Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={8}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Typography variant="overline" color="text.secondary">This membership</Typography>
                                    {/* Both rows share one three-column grid. They used to be a
                                        Grid above a space-between flex row, so the figures in the
                                        second row sat at different x positions from the ones above
                                        them and the last item was flung against the right edge. */}
                                    <Grid container spacing={2} mt={0}>
                                        {[
                                            ['Plan fee', fmtMoney(data.membership_fee), 'text.primary', null],
                                            ['Paid', fmtMoney(data.amount_paid), 'success.main', null],
                                            ['Outstanding', fmtMoney(data.amount_due),
                                                data.amount_due > 0 ? 'error.main' : 'text.primary',
                                                data.amount_due > 0 ? 'Access is locked until this is cleared' : null],
                                        ].map(([label, value, colour, hint]) => (
                                            <Grid item xs={12} sm={4} key={label}>
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    {label}
                                                </Typography>
                                                <Typography variant="h5" fontWeight={800} color={colour}>{value}</Typography>
                                                {hint && (
                                                    <Typography variant="caption" color="error.main">{hint}</Typography>
                                                )}
                                            </Grid>
                                        ))}
                                    </Grid>
                                    <Divider sx={{ my: 2 }} />
                                    <Grid container spacing={2}>
                                        {[
                                            ['Paid towards membership', fmtMoney(paidToDate)],
                                            ['Payments recorded', String(membershipPayments.length)],
                                            ['Last payment',
                                                membershipPayments[0] ? fmtDate(membershipPayments[0].payment_date) : '—'],
                                        ].map(([label, value]) => (
                                            <Grid item xs={12} sm={4} key={label}>
                                                <Typography variant="caption" color="text.secondary" display="block">
                                                    {label}
                                                </Typography>
                                                <Typography variant="h5" fontWeight={800}>{value}</Typography>
                                            </Grid>
                                        ))}
                                    </Grid>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12}>
                            <Paper elevation={3} sx={{ p: 3 }}>
                                <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                    <ReceiptLong sx={{ color: 'primary.main' }} />
                                    <Typography variant="h6">Payment history</Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary" mb={2}>
                                    Every payment the gym has recorded against your membership.
                                    Open a receipt to print it or save it as a PDF.
                                    {hasPt && hasLocker
                                        ? ' Personal training and your locker are billed separately'
                                          + ' — see those tabs.'
                                        : hasPt
                                            ? ' Personal training is billed separately — see that tab.'
                                            : hasLocker
                                                ? ' Locker rent is billed separately — see that tab.'
                                                : ''}
                                </Typography>
                                {receiptError && (
                                    <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setReceiptError('')}>
                                        {receiptError}
                                    </Alert>
                                )}
                                {/* Six columns at 390px meant Receipt, Method and
                                    the Receipt button were all off-screen. On a
                                    phone each payment becomes a block: what it
                                    bought, when and how, the amount, and the
                                    receipt button underneath. */}
                                <Ledger
                                    rows={membershipPayments}
                                    getKey={(p, i) => p.id ?? i}
                                    empty="No payments recorded yet."
                                    columns={[
                                        { key: 'receipt', label: 'Receipt', render: (p) => (
                                            <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                {receiptNo(p)}
                                            </Box>
                                        ) },
                                        { key: 'date', label: 'Date', render: (p) => fmtDate(p.payment_date) },
                                        { key: 'method', label: 'Method', render: (p) => p.method || 'Cash' },
                                        { key: 'for', label: 'For', render: (p) => {
                                            // What the money bought, read off the payment row —
                                            // never off the membership the member holds today.
                                            const d = describePayment(p);
                                            return (
                                                <>
                                                    <Typography variant="body2" fontWeight={600}>{d.title}</Typography>
                                                    {d.period && (
                                                        <Typography variant="caption" color="text.secondary" display="block">
                                                            {d.period}
                                                        </Typography>
                                                    )}
                                                    {Number(p.discount) > 0 && (
                                                        <Typography variant="caption" color="success.main" display="block" fontWeight={600}>
                                                            Referral reward {fmtMoney(p.discount)} off
                                                        </Typography>
                                                    )}
                                                </>
                                            );
                                        } },
                                        { key: 'amount', label: 'Amount', align: 'right', render: (p) => (
                                            <Box component="span" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                {fmtMoney(p.amount)}
                                            </Box>
                                        ) },
                                        { key: 'action', label: '', align: 'right', render: (p) => (
                                            <Button size="small" startIcon={<Download />}
                                                sx={{ whiteSpace: 'nowrap' }} onClick={() => openReceipt(p)}>
                                                Receipt
                                            </Button>
                                        ) },
                                    ]}
                                    primary={(p) => describePayment(p).title}
                                    meta={(p) => {
                                        const d = describePayment(p);
                                        return (
                                            <>
                                                {fmtDate(p.payment_date)} · {p.method || 'Cash'} · {receiptNo(p)}
                                                {d.period && <Box component="span" sx={{ display: 'block' }}>{d.period}</Box>}
                                                {Number(p.discount) > 0 && (
                                                    <Box component="span" sx={{ display: 'block', color: 'success.main', fontWeight: 600 }}>
                                                        Referral reward {fmtMoney(p.discount)} off
                                                    </Box>
                                                )}
                                            </>
                                        );
                                    }}
                                    value={(p) => fmtMoney(p.amount)}
                                    trailing={(p) => (
                                        <Button size="small" startIcon={<Download />} onClick={() => openReceipt(p)}>
                                            Receipt
                                        </Button>
                                    )}
                                />
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                {/* Refer & earn */}
                {/* ---- Personal training (only for members who have bought it) ---- */}
                {hasPt && (
                    <TabPanel value={tab} index={TAB('training')}>
                        <Grid container spacing={2}>
                            <Grid item xs={12} md={4}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="overline" color="text.secondary">Your trainer</Typography>
                                        <Box display="flex" alignItems="center" gap={2} mt={1.5} mb={2}>
                                            <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56, fontWeight: 800 }}>
                                                {String(ptTrainerName || '?').split(' ').filter(Boolean)
                                                    .map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                                            </Avatar>
                                            <Box sx={{ minWidth: 0 }}>
                                                <Typography variant="h6" fontWeight={800} noWrap>
                                                    {ptTrainerName || 'To be assigned'}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">Personal trainer</Typography>
                                            </Box>
                                        </Box>
                                        <Divider sx={{ mb: 1.5 }} />
                                        <Stack spacing={1}>
                                            {data.trainer?.phone && (
                                                <Box display="flex" alignItems="center" gap={1}>
                                                    <PhoneIphone fontSize="small" color="disabled" />
                                                    <Typography variant="body2">{data.trainer.phone}</Typography>
                                                </Box>
                                            )}
                                            {data.trainer?.email && (
                                                <Box display="flex" alignItems="center" gap={1} sx={{ minWidth: 0 }}>
                                                    <MailOutline fontSize="small" color="disabled" />
                                                    <Typography variant="body2" noWrap>{data.trainer.email}</Typography>
                                                </Box>
                                            )}
                                            {!data.trainer?.phone && !data.trainer?.email && (
                                                <Typography variant="body2" color="text.secondary">
                                                    Ask at the front desk to be put in touch.
                                                </Typography>
                                            )}
                                        </Stack>
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12} md={8}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="overline" color="text.secondary">Your training plan</Typography>
                                        {!ptPlan ? (
                                            <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                                                No training plan yet. Your trainer can set one up at the desk.
                                            </Typography>
                                        ) : (
                                            <>
                                                {/* Four facts about the term the member bought. Each carries
                                                    the line that makes its number readable: a fee of ₹9,000 says
                                                    nothing until it says ₹9,000 *for three months*.

                                                    The plan IS the term. Personal training is sold the way
                                                    membership is — monthly, quarterly, half-yearly, yearly —
                                                    so a member who bought a month reads "Monthly". Package
                                                    names left over from the session era said things like
                                                    "12 Session Strength", which describes a product this gym
                                                    does not sell. */}
                                                <Grid container spacing={2} mt={0}>
                                                    {[
                                                        ['Plan', ptPlan.plan_type || '—', 'text.primary',
                                                            ptPlan.totalDays ? `${ptPlan.totalDays} days` : null],
                                                        ['Valid until', fmtDate(ptPlan.expiry_date), 'text.primary',
                                                            ptPlan.start_date ? `from ${fmtDate(ptPlan.start_date)}` : null],
                                                        ['Days left', ptPlan.daysLeft == null ? '—' : ptPlan.daysLeft,
                                                            ptPlan.daysLeft === 0 ? 'error.main' : 'primary.main',
                                                            ptPlan.totalDays ? `of ${ptPlan.totalDays}` : null],
                                                        ['PT charges', fmtMoney(ptPlan.fee), 'success.main',
                                                            ptPlan.perMonth ? `${fmtMoney(ptPlan.perMonth)} per month` : null],
                                                    ].map(([label, value, colour, hint]) => (
                                                        <Grid item xs={6} sm={3} key={label}>
                                                            <Typography variant="caption" color="text.secondary" display="block">
                                                                {label}
                                                            </Typography>
                                                            <Typography variant="h5" fontWeight={800} color={colour}
                                                                sx={{
                                                                    fontSize: { xs: '1.05rem', sm: '1.25rem' },
                                                                    lineHeight: 1.25, wordBreak: 'break-word',
                                                                }}>
                                                                {value}
                                                            </Typography>
                                                            {hint && (
                                                                <Typography variant="caption" color="text.secondary"
                                                                    display="block" sx={{ mt: 0.25 }}>
                                                                    {hint}
                                                                </Typography>
                                                            )}
                                                        </Grid>
                                                    ))}
                                                </Grid>
                                                {ptPlan.pctLeft != null && (
                                                    <LinearProgress
                                                        variant="determinate"
                                                        sx={{ mt: 2.5, mb: 0.5, height: 8, borderRadius: 4 }}
                                                        value={ptPlan.pctLeft}
                                                        color={ptPlan.daysLeft === 0 ? 'error'
                                                            : ptPlan.daysLeft <= 14 ? 'warning' : 'primary'} />
                                                )}
                                                {/* The bar tracks the term, so the line under it does too. It
                                                    used to count sessions instead — a member on a three-month
                                                    plan was told "9 of 12 left", which is not what they bought
                                                    and not something this gym sells. */}
                                                <Typography variant="caption" color="text.secondary">
                                                    {ptPlan.over
                                                        ? 'Your training plan has ended — renew with your trainer to continue.'
                                                        : `${ptPlan.daysLeft} of ${ptPlan.totalDays} days left`}
                                                </Typography>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12}>
                                <Paper elevation={3} sx={{ p: 3 }}>
                                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                                        <ReceiptLong sx={{ color: 'primary.main' }} />
                                        <Typography variant="h6">Plans &amp; payments</Typography>
                                    </Box>
                                    <Ledger
                                        rows={data.pt_subscriptions || []}
                                        getKey={(p) => p.id}
                                        empty="No training plans yet."
                                        footer={{
                                            label: 'Paid for training, all plans',
                                            value: fmtMoney(ptPlan?.lifetimeFee || 0),
                                        }}
                                        columns={[
                                            { key: 'plan', label: 'Plan', render: (p) => (
                                                <>
                                                    <Typography variant="body2" fontWeight={600}>{p.plan_type || '—'}</Typography>
                                                    {termDays(p) > 0 && (
                                                        <Typography variant="caption" color="text.secondary">{termDays(p)} days</Typography>
                                                    )}
                                                </>
                                            ) },
                                            { key: 'trainer', label: 'Trainer', render: (p) => p.trainer_name || ptTrainerName || '—' },
                                            { key: 'start', label: 'Started', render: (p) => fmtDate(p.start_date) },
                                            { key: 'until', label: 'Valid until', render: (p) => fmtDate(p.expiry_date) },
                                            { key: 'price', label: 'PT charges', align: 'right', render: (p) => (
                                                <>
                                                    <Typography variant="body2" fontWeight={700}>{fmtMoney(p.price)}</Typography>
                                                    {termDays(p) > 0 && (
                                                        <Typography variant="caption" color="text.secondary">
                                                            {fmtMoney(Number(p.price || 0) / (termDays(p) / 30))} per month
                                                        </Typography>
                                                    )}
                                                </>
                                            ) },
                                            { key: 'status', label: 'Status', align: 'center', render: (p) => (
                                                <Chip size="small" label={p.status}
                                                    color={p.status === 'active' ? 'success' : 'default'}
                                                    variant={p.status === 'active' ? 'filled' : 'outlined'} />
                                            ) },
                                            { key: 'action', label: '', align: 'right', render: (p) => {
                                                const receipt = (data.payments || [])
                                                    .find(x => x.purpose === 'pt' && x.reference_id === p.id);
                                                return receipt ? (
                                                    <Button size="small" startIcon={<Download />}
                                                        sx={{ whiteSpace: 'nowrap' }} onClick={() => openReceipt(receipt)}>
                                                        Receipt
                                                    </Button>
                                                ) : null;
                                            } },
                                        ]}
                                        primary={(p) => (
                                            <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                                {p.plan_type || '—'}
                                                <Chip size="small" label={p.status}
                                                    color={p.status === 'active' ? 'success' : 'default'}
                                                    variant={p.status === 'active' ? 'filled' : 'outlined'} />
                                            </Box>
                                        )}
                                        meta={(p) => (
                                            <>
                                                {p.trainer_name || ptTrainerName || '—'}
                                                <Box component="span" sx={{ display: 'block' }}>
                                                    {fmtDate(p.start_date)} – {fmtDate(p.expiry_date)}
                                                    {termDays(p) > 0 ? ` · ${termDays(p)} days` : ''}
                                                </Box>
                                            </>
                                        )}
                                        value={(p) => fmtMoney(p.price)}
                                        trailing={(p) => {
                                            const receipt = (data.payments || [])
                                                .find(x => x.purpose === 'pt' && x.reference_id === p.id);
                                            return receipt ? (
                                                <Button size="small" startIcon={<Download />} onClick={() => openReceipt(receipt)}>
                                                    Receipt
                                                </Button>
                                            ) : null;
                                        }}
                                    />
                                </Paper>
                            </Grid>

                            <Grid item xs={12}>
                                <Paper elevation={3} sx={{ p: 3 }}>
                                    <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                        <SelfImprovement sx={{ color: 'primary.main' }} />
                                        <Typography variant="h6">Session history</Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        {(data.pt_sessions || []).length === 0
                                            ? 'Every session your trainer records will appear here.'
                                            : `${(data.pt_sessions || []).length} session${(data.pt_sessions || []).length === 1 ? '' : 's'} recorded, newest first.`}
                                    </Typography>
                                    <Ledger
                                        rows={data.pt_sessions || []}
                                        getKey={(ses, i) => `${ses.session_date}-${i}`}
                                        empty="No sessions recorded yet."
                                        columns={[
                                            { key: 'date', label: 'Date', render: (ses) => fmtDate(ses.session_date) },
                                            { key: 'time', label: 'Time', render: (ses) => fmtTime(ses.session_time) },
                                            { key: 'trainer', label: 'Trainer', render: (ses) => ses.trainer_name || ptTrainerName || '—' },
                                            // Only worth a column when the member has held more than
                                            // one plan; otherwise it repeats the same name every row.
                                            ...((data.pt_subscriptions || []).length > 1
                                                ? [{ key: 'plan', label: 'Plan', render: (ses) => ses.package_name }]
                                                : []),
                                            { key: 'notes', label: 'Notes', render: (ses) => (
                                                <Box component="span" sx={{ color: 'text.secondary' }}>{ses.notes || '—'}</Box>
                                            ) },
                                        ]}
                                        primary={(ses) => `${fmtDate(ses.session_date)} · ${fmtTime(ses.session_time)}`}
                                        meta={(ses) => (
                                            <>
                                                {ses.trainer_name || ptTrainerName || '—'}
                                                {(data.pt_subscriptions || []).length > 1 && ses.package_name
                                                    ? ` · ${ses.package_name}` : ''}
                                                {ses.notes && (
                                                    <Box component="span" sx={{ display: 'block' }}>{ses.notes}</Box>
                                                )}
                                            </>
                                        )}
                                    />
                                </Paper>
                            </Grid>
                        </Grid>
                    </TabPanel>
                )}

                {/* ---- Locker (only for members who hold one) ---- */}
                {hasLocker && (
                    <TabPanel value={tab} index={TAB('locker')}>
                        <Grid container spacing={2}>
                            <Grid item xs={12} md={4}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="overline" color="text.secondary">Your locker</Typography>
                                        <Box display="flex" alignItems="center" gap={2} mt={1.5} mb={2}>
                                            <Avatar sx={{ bgcolor: 'primary.main', width: 56, height: 56, fontWeight: 800 }}>
                                                <Lock />
                                            </Avatar>
                                            <Box sx={{ minWidth: 0 }}>
                                                <Typography variant="h6" fontWeight={800} noWrap>
                                                    {locker.locker_number}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {[locker.size, locker.location].filter(Boolean).join(' · ') || 'Locker'}
                                                </Typography>
                                            </Box>
                                        </Box>
                                        <Divider sx={{ mb: 1.5 }} />
                                        <Typography variant="body2" color="text.secondary">
                                            Keep it locked and take your key with you. The front desk can move you to
                                            another locker if you need a different size.
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12} md={8}>
                                <Card sx={{ height: '100%' }}>
                                    <CardContent>
                                        <Typography variant="overline" color="text.secondary">Your rental</Typography>
                                        <Grid container spacing={2} mt={0}>
                                            {[
                                                ['Locker', locker.locker_number, 'text.primary',
                                                    locker.size || null],
                                                ['Held until', fmtDate(locker.assigned_until), 'text.primary',
                                                    locker.assigned_from ? `from ${fmtDate(locker.assigned_from)}` : null],
                                                ['Days left', locker.daysLeft == null ? '—' : locker.daysLeft,
                                                    locker.daysLeft === 0 ? 'error.main' : 'primary.main',
                                                    locker.totalDays ? `of ${locker.totalDays}` : null],
                                                ['Rent', fmtMoney(locker.monthly_rent), 'success.main', 'per month'],
                                            ].map(([label, value, colour, hint]) => (
                                                <Grid item xs={6} sm={3} key={label}>
                                                    <Typography variant="caption" color="text.secondary" display="block">
                                                        {label}
                                                    </Typography>
                                                    <Typography variant="h5" fontWeight={800} color={colour}
                                                        sx={{
                                                            fontSize: { xs: '1.05rem', sm: '1.25rem' },
                                                            lineHeight: 1.25, wordBreak: 'break-word',
                                                        }}>
                                                        {value}
                                                    </Typography>
                                                    {hint && (
                                                        <Typography variant="caption" color="text.secondary"
                                                            display="block" sx={{ mt: 0.25 }}>
                                                            {hint}
                                                        </Typography>
                                                    )}
                                                </Grid>
                                            ))}
                                        </Grid>
                                        {locker.pctLeft != null && (
                                            <LinearProgress
                                                variant="determinate"
                                                sx={{ mt: 2.5, mb: 0.5, height: 8, borderRadius: 4 }}
                                                value={locker.pctLeft}
                                                color={locker.daysLeft === 0 ? 'error'
                                                    : locker.daysLeft <= 7 ? 'warning' : 'primary'} />
                                        )}
                                        <Typography variant="caption" color="text.secondary">
                                            {locker.over
                                                ? 'Your locker rental has ended — renew it at the front desk to keep using it.'
                                                : `${locker.daysLeft} of ${locker.totalDays} days left`}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>

                            <Grid item xs={12}>
                                <Paper elevation={3} sx={{ p: 3 }}>
                                    <Box display="flex" alignItems="center" gap={1} mb={0.5}>
                                        <ReceiptLong sx={{ color: 'primary.main' }} />
                                        <Typography variant="h6">Charges &amp; invoices</Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary" mb={2}>
                                        Locker rent is billed separately from your membership.
                                    </Typography>
                                    <Ledger
                                        rows={lockerPayments}
                                        getKey={(p, i) => p.id ?? i}
                                        empty="Nothing charged for this locker — it comes with your membership."
                                        columns={[
                                            { key: 'receipt', label: 'Receipt', render: (p) => (
                                                <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                    {receiptNo(p)}
                                                </Box>
                                            ) },
                                            { key: 'date', label: 'Date', render: (p) => fmtDate(p.payment_date) },
                                            { key: 'method', label: 'Method', render: (p) => p.method || 'Cash' },
                                            { key: 'period', label: 'Period covered', render: (p) => (
                                                p.period_start && p.period_end
                                                    ? `${fmtDate(p.period_start)} – ${fmtDate(p.period_end)}`
                                                    : '—'
                                            ) },
                                            { key: 'amount', label: 'Amount', align: 'right', render: (p) => (
                                                <Box component="span" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                    {fmtMoney(p.amount)}
                                                </Box>
                                            ) },
                                            { key: 'action', label: '', align: 'right', render: (p) => (
                                                <Button size="small" startIcon={<Download />}
                                                    sx={{ whiteSpace: 'nowrap' }} onClick={() => openReceipt(p)}>
                                                    Receipt
                                                </Button>
                                            ) },
                                        ]}
                                        primary={(p) => `Locker rent · ${p.method || 'Cash'}`}
                                        meta={(p) => (
                                            <>
                                                {fmtDate(p.payment_date)} · {receiptNo(p)}
                                                {p.period_start && p.period_end && (
                                                    <Box component="span" sx={{ display: 'block' }}>
                                                        {fmtDate(p.period_start)} – {fmtDate(p.period_end)}
                                                    </Box>
                                                )}
                                            </>
                                        )}
                                        value={(p) => fmtMoney(p.amount)}
                                        trailing={(p) => (
                                            <Button size="small" startIcon={<Download />} onClick={() => openReceipt(p)}>
                                                Receipt
                                            </Button>
                                        )}
                                    />

                                    {lockerInvoices.length > 0 && (
                                        <>
                                            <Divider sx={{ my: 2.5 }} />
                                            <Typography variant="subtitle2" fontWeight={700} mb={1}>
                                                Tax invoices
                                            </Typography>
                                            <Ledger
                                                rows={lockerInvoices}
                                                getKey={(inv) => inv.id}
                                                empty="No invoices yet."
                                                columns={[
                                                    { key: 'no', label: 'Invoice', render: (inv) => (
                                                        <Box component="span" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                            {inv.invoice_no}
                                                        </Box>
                                                    ) },
                                                    { key: 'date', label: 'Date', render: (inv) => fmtDate(inv.invoice_date) },
                                                    { key: 'total', label: 'Total', align: 'right', render: (inv) => (
                                                        <Box component="span" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                            {fmtMoney(inv.total)}
                                                        </Box>
                                                    ) },
                                                    { key: 'status', label: 'Status', align: 'center', render: (inv) => (
                                                        <Chip size="small" label={inv.status}
                                                            color={inv.status === 'paid' ? 'success' : 'warning'}
                                                            variant={inv.status === 'paid' ? 'filled' : 'outlined'} />
                                                    ) },
                                                    { key: 'action', label: '', align: 'right', render: (inv) => (
                                                        <Button size="small" startIcon={<Download />}
                                                            sx={{ whiteSpace: 'nowrap' }} onClick={() => openInvoice(inv)}>
                                                            Invoice
                                                        </Button>
                                                    ) },
                                                ]}
                                                primary={(inv) => (
                                                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                                        {inv.invoice_no}
                                                        <Chip size="small" label={inv.status}
                                                            color={inv.status === 'paid' ? 'success' : 'warning'}
                                                            variant={inv.status === 'paid' ? 'filled' : 'outlined'} />
                                                    </Box>
                                                )}
                                                meta={(inv) => fmtDate(inv.invoice_date)}
                                                value={(inv) => fmtMoney(inv.total)}
                                                trailing={(inv) => (
                                                    <Button size="small" startIcon={<Download />} onClick={() => openInvoice(inv)}>
                                                        Invoice
                                                    </Button>
                                                )}
                                            />
                                        </>
                                    )}
                                </Paper>
                            </Grid>
                        </Grid>
                    </TabPanel>
                )}

                <TabPanel value={tab} index={TAB('refer')}>
                    <Alerts items={[
                        inviteMsg && { severity: 'success', text: inviteMsg },
                        inviteErr && { severity: 'error', text: inviteErr },
                    ]} />

                    {!referral ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                            <CircularProgress />
                        </Box>
                    ) : !referral.offer?.enabled ? (
                        <Paper sx={{ p: 4, textAlign: 'center' }}>
                            <CardGiftcard sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                            <Typography variant="subtitle1">Referrals aren't running right now</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Ask at the front desk — the gym may have a different offer on.
                            </Typography>
                        </Paper>
                    ) : (
                        <Grid container spacing={3}>
                            {/* The offer + the member's code */}
                            <Grid item xs={12} md={5}>
                                <Paper sx={{ p: 3, height: '100%',
                                    background: 'linear-gradient(135deg, #065f46 0%, #0f766e 100%)', color: '#fff' }}>
                                    <CardGiftcard sx={{ fontSize: 32, mb: 1 }} />
                                    <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.25 }}>
                                        {referral.offer.label}
                                    </Typography>
                                    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)', mt: 1 }}>
                                        Every friend who joins earns you the reward. Share your code — they
                                        give it at the front desk when they sign up.
                                    </Typography>

                                    <Box sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: 'rgba(0,0,0,0.25)' }}>
                                        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                                            YOUR REFERRAL CODE
                                        </Typography>
                                        <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                                            <Typography variant="h5" fontWeight={800}
                                                sx={{ letterSpacing: '0.08em', fontFamily: 'monospace' }}>
                                                {referral.referral_code || '—'}
                                            </Typography>
                                            <Button size="small" startIcon={<ContentCopy />}
                                                onClick={() => copyCode(referral.referral_code)}
                                                sx={{ color: '#a7f3d0', ml: 'auto' }}>
                                                {copied ? 'Copied' : 'Copy'}
                                            </Button>
                                        </Box>
                                    </Box>

                                    <Button
                                        fullWidth variant="contained" startIcon={<Share />}
                                        /* The slab is theme-independent dark green, but this button
                                           took primary.main — #047857 in light, which is the slab's
                                           own colour. 1.00:1 at one end: the gym's main referral CTA
                                           had no edge at all on paper, just a floating label. */
                                        sx={{ mt: 2,
                                            bgcolor: onInk ? T.accent : '#ECFDF5',
                                            color: onInk ? '#04140E' : '#065F46',
                                            '&:hover': { bgcolor: onInk ? '#5CFFC8' : '#D1FAE5' } }}
                                        onClick={() => {
                                            const text = `Join me at ${brand.name}! Use my referral code `
                                                + `${referral.referral_code} — ${referral.offer.label}. ${shareLink}`;
                                            if (navigator.share) {
                                                navigator.share({ title: brand.name, text }).catch(() => {});
                                            } else {
                                                copyCode(text);
                                            }
                                        }}
                                    >
                                        Share with a friend
                                    </Button>
                                </Paper>
                            </Grid>

                            {/* Their tally + the invite form */}
                            <Grid item xs={12} md={7}>
                                <Grid container spacing={2} sx={{ mb: 2 }}>
                                    {[
                                        { label: 'Invited', value: referral.invited, colour: 'text.primary' },
                                        { label: 'Joined', value: referral.joined, colour: 'success.main' },
                                        { label: 'Still deciding', value: referral.pending, colour: 'warning.main' },
                                        { label: 'Earned', value: fmtMoney(referral.earned || 0), colour: 'primary.main' },
                                    ].map(k => (
                                        <Grid item xs={6} sm={3} key={k.label}>
                                            <Card sx={{ height: '100%' }}>
                                                <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                                                    <Typography variant="h6" fontWeight={800} color={k.colour}>
                                                        {k.value}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {k.label}
                                                    </Typography>
                                                </CardContent>
                                            </Card>
                                        </Grid>
                                    ))}
                                </Grid>

                                <Paper sx={{ p: 3, mb: 2 }}>
                                    <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                                        Invite someone
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                        Tell us who you've told, and we'll credit you the moment they join.
                                    </Typography>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                        <TextField fullWidth required label="Their name" value={inviteForm.referred_name}
                                            onChange={e => setInviteForm({ ...inviteForm, referred_name: e.target.value })} />
                                        <TextField fullWidth required label="Their phone" value={inviteForm.referred_phone}
                                            inputProps={{ inputMode: 'tel', maxLength: 10 }}
                                            placeholder="10-digit mobile"
                                            onChange={e => setInviteForm({
                                                ...inviteForm,
                                                referred_phone: e.target.value.replace(/\D/g, '').slice(0, 10),
                                            })} />
                                        <Button variant="contained" onClick={submitInvite} sx={{ flexShrink: 0 }}>
                                            Add
                                        </Button>
                                    </Stack>
                                </Paper>

                                <Paper sx={{ p: 0 }}>
                                    <Typography variant="subtitle1" fontWeight={700} sx={{ p: 3, pb: 1 }}>
                                        Your invitations
                                    </Typography>
                                    <Box sx={{ px: 3, pb: 3 }}>
                                        <Ledger
                                            rows={referral.referrals}
                                            getKey={(r) => r.id}
                                            empty="No invitations yet. Share your code above to get started."
                                            columns={[
                                                { key: 'name', label: 'Friend', render: (r) => (
                                                    <Box component="span" sx={{ fontWeight: 600 }}>{r.name}</Box>
                                                ) },
                                                { key: 'invited', label: 'Invited', render: (r) => fmtDate(r.created_at) },
                                                { key: 'status', label: 'Status', render: (r) => (
                                                    <Chip size="small" label={referralStatusLabel(r.status)}
                                                        color={referralStatusColor(r.status)}
                                                        variant={r.status === 'rewarded' ? 'filled' : 'outlined'} />
                                                ) },
                                                { key: 'reward', label: 'Reward', align: 'right', render: (r) => (
                                                    Number(r.reward_value) > 0 ? fmtMoney(r.reward_value) : '—'
                                                ) },
                                            ]}
                                            primary={(r) => (
                                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                                                    {r.name}
                                                    <Chip size="small" label={referralStatusLabel(r.status)}
                                                        color={referralStatusColor(r.status)}
                                                        variant={r.status === 'rewarded' ? 'filled' : 'outlined'} />
                                                </Box>
                                            )}
                                            meta={(r) => `Invited ${fmtDate(r.created_at)}`}
                                            value={(r) => (Number(r.reward_value) > 0 ? fmtMoney(r.reward_value) : '—')}
                                        />
                                    </Box>
                                </Paper>
                            </Grid>
                        </Grid>
                    )}
                </TabPanel>

                <Dialog open={changeOpen} onClose={() => setChangeOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle sx={{ fontWeight: 800 }}>Change your password</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Pick something only you know. You will stay signed in.
                    </Typography>
                    <Alerts items={[loginError && { severity: 'error', text: loginError }]} />
                    <Stack spacing={2} mt={1}>
                        <TextField fullWidth label="Current password" type="password"
                            value={form.current_password} autoComplete="current-password"
                            onChange={e => setForm({ ...form, current_password: e.target.value })}
                            InputProps={{ startAdornment: <Lock color="disabled" fontSize="small" sx={{ mr: 1 }} /> }} />
                        {newPasswordFields(changeFromPortal)}
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={() => setChangeOpen(false)}>Not now</Button>
                    <Button variant="contained" onClick={changeFromPortal} disabled={loginLoading}>
                        {loginLoading ? 'Saving…' : 'Change password'}
                    </Button>
                </DialogActions>
            </Dialog>

            <PoweredBy />
            </Box>
        </Box>
    );
};

export default MemberPortal;
