// frontend/src/components/Login.jsx
import React, { useRef, useState } from 'react';
import {
    Paper, Typography, TextField, Button, Box, GridLegacy as Grid, InputAdornment, IconButton, Link } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Alerts from './Alerts';
import { normaliseUsername, typedUsername, usernameInputProps } from './ui/username';
import { Visibility, VisibilityOff, Lock, Person,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';
import ForgotPasswordDialog from './ForgotPasswordDialog.jsx';
import useBranding from './ui/useBranding';
import PoweredBy from './ui/PoweredBy';
import { signInGround, signInRail, signInRailInner, signInCard, signInQuote, signInRule } from './ui/signInLook';

const Login = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    // The browser is the only thing that knows whether Caps Lock is down, and
    // it only says so during a key event on a focused field. Worth asking:
    // a password field shows dots, so nothing else can tell a person their
    // keyboard is shouting.
    const [capsLock, setCapsLock] = useState(false);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [forgotOpen, setForgotOpen] = useState(false);
    // Set when the backend says this account is locked out of passwords until
    // it sets a new one — the reset dialog then opens on its own, pre-filled,
    // instead of leaving the user to find "Forgot password?" themselves.
    const [mustReset, setMustReset] = useState(false);
    const passwordRef = useRef(null);
    const brand = useBranding();
    // The ground follows the chosen theme, exactly as the member portal's does.
    // Pinned dark it was the last thing making the two doors look like two
    // different products: a white card floating on ink for staff, a matched
    // pair for members.
    const onInk = useTheme().palette.mode === 'dark';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        log('Login', 'handleSubmit', `→ login attempt for user "${username}"`);
        try {
            const res = await api.post('/auth/login', { username: normaliseUsername(username), password });
            log('Login', 'handleSubmit', `← login ok for user "${username}" (role ${res.data.user ? res.data.user.role : '?'})`);
            localStorage.setItem('gym_token', res.data.token);
            localStorage.setItem('gym_user', JSON.stringify(res.data.user));
            setPassword('');
            onLogin(res.data.user);
        } catch (err) {
            logError('Login', 'handleSubmit', `✗ login failed for "${username}": ${err.response?.data?.error || err.message}`, err);
            const serverError = err.response?.data?.error || 'Login failed. Check your credentials.';
            // The server appends a marker rather than a separate field so the
            // Node and Java backends stay response-compatible. There is no
            // timed lockout to handle — a spent allowance always arrives as
            // this marker, and the way forward is always the reset dialog.
            setMustReset(serverError.includes('PASSWORD_RESET_REQUIRED'));
            setError(serverError.replace('PASSWORD_RESET_REQUIRED', '').trim());
            // A rejected password is never left on screen or in state. A
            // half-typed credential sitting in a field invites the next person
            // at the desk to press Enter, and an unmasked retry is the oldest
            // shoulder-surfing target there is. The user retypes it in full,
            // which is what every banking login does.
            setPassword('');
            setShowPassword(false);
            passwordRef.current?.focus();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                p: { xs: 2, sm: 3 },
                ...signInGround(onInk, brand.colour),
            }}
        >
            <Paper elevation={0} sx={{ ...signInCard(false), maxWidth: 940, width: '100%' }}>
                <Grid container>
                    {/* Branding panel */}
                    <Grid item xs={12} md={5}>
                        <Box
                            sx={{
                                ...signInRail(brand.colour),
                                p: { xs: 4, md: 5 },
                                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                                minHeight: { md: 520 },
                            }}
                        >
                            {/* One block, vertically centred. Held apart with
                                space-between, the mark sat alone at the top of a
                                520px slab with 180px of bare green under it —
                                two fragments rather than one composition. */}
                            <Box sx={signInRailInner}>
                                <Box
                                    sx={{
                                        width: 56, height: 56, borderRadius: '18px',
                                        bgcolor: 'rgba(255,255,255,0.16)',
                                        border: '1px solid rgba(255,255,255,0.22)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 30, flexShrink: 0, mb: 3,
                                    }}
                                >
                                    {brand.logo}
                                </Box>
                                {/* The gym's name was printed twice on this panel —
                                    small at the top and large below — and the small
                                    copy had nowhere to go, so "Gold's Gym, Jehanabad"
                                    arrived as "Gold's Gym, Jehanab…". One name, at
                                    the size that can hold any gym's. */}
                                <Typography
                                    sx={{
                                        fontSize: { xs: 30, md: 38 }, fontWeight: 900,
                                        letterSpacing: '-0.03em', lineHeight: 1.08,
                                        textWrap: 'balance',
                                    }}
                                >
                                    {brand.name}
                                </Typography>
                                {brand.tagline && (
                                    <Typography
                                        sx={{
                                            mt: 1, fontSize: 12, fontWeight: 700,
                                            letterSpacing: '0.16em', textTransform: 'uppercase',
                                            color: 'rgba(255,255,255,0.82)',
                                        }}
                                    >
                                        {brand.tagline}
                                    </Typography>
                                )}
                                {/* The gym's own words, and the only other place the
                                    bright accent is spent on this screen. */}
                                {brand.quote && (
                                    <>
                                        <Box sx={signInRule(brand.colour)} />
                                        <Typography variant="body1" sx={signInQuote}>
                                            {brand.quote}
                                        </Typography>
                                    </>
                                )}
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 3.5 }}>
                                    {[
                                        brand.phone && { icon: '📞', text: brand.phone },
                                        brand.email && { icon: '✉️', text: brand.email },
                                        brand.address && { icon: '📍', text: brand.address },
                                    ].filter(Boolean).map(item => (
                                        <Typography key={item.text} variant="body2"
                                            sx={{ color: 'rgba(255,255,255,0.92)' }}>
                                            {item.icon}&nbsp; {item.text}
                                        </Typography>
                                    ))}
                                </Box>
                            </Box>
                        </Box>
                    </Grid>

                    {/* Form panel */}
                    <Grid item xs={12} md={7}>
                        {/* No hardcoded ground. This panel was pinned to #FFFFFF
                            with ink text, so the staff door stayed a white slab
                            whatever theme the app was in — and next to the member
                            portal, which renders the same card through its own
                            theme, the two doors looked like different products.
                            The staff dark theme already has the surface for this
                            (paper #131A24) and already flips a filled button's
                            label to ink; forcing white was the only thing
                            stopping it being used. */}
                        <Box sx={{
                            p: { xs: 4, md: 6 },
                            height: '100%',
                            display: 'flex', flexDirection: 'column', justifyContent: 'center',
                            bgcolor: 'background.paper',
                        }}>
                            <Typography
                                sx={{
                                    fontSize: 30, fontWeight: 900, letterSpacing: '-0.03em',
                                    lineHeight: 1.1, color: 'text.primary', mb: 0.75,
                                }}
                            >
                                Welcome back
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 3.5 }}>
                                Sign in to your gym dashboard
                            </Typography>

                            <Alerts items={[error && { severity: 'error', text: error }]} />

                            <form onSubmit={handleSubmit}>
                                {/* Case is not part of the identity — the server folds
                                    it before it looks anything up — so the field keeps
                                    what was pressed while it is being typed and folds
                                    on blur. Echoing "ADMIN" back at someone typing
                                    "admin" reads as Caps Lock, and the password below,
                                    which IS case-sensitive, gets typed on that belief.
                                    The password is never transformed. */}
                                <TextField
                                    fullWidth label="Username" value={username}
                                    onChange={e => setUsername(typedUsername(e.target.value))}
                                    onBlur={() => setUsername(u => normaliseUsername(u))}
                                    margin="normal" required
                                    inputProps={usernameInputProps}
                                    InputProps={{ startAdornment: (
                                        <InputAdornment position="start"><Person fontSize="small" color="disabled" /></InputAdornment>
                                    ) }}
                                />
                                <TextField
                                    fullWidth label="Password" type={showPassword ? 'text' : 'password'}
                                    value={password} onChange={e => setPassword(e.target.value)} margin="normal" required
                                    inputRef={passwordRef}
                                    autoComplete="current-password"
                                    onKeyUp={e => setCapsLock(e.getModifierState && e.getModifierState('CapsLock'))}
                                    onKeyDown={e => setCapsLock(e.getModifierState && e.getModifierState('CapsLock'))}
                                    onBlur={() => setCapsLock(false)}
                                    helperText={capsLock ? 'Caps Lock is on — passwords are case-sensitive.' : ' '}
                                    FormHelperTextProps={{ sx: { color: capsLock ? 'warning.main' : 'transparent' } }}
                                    InputProps={{
                                        startAdornment: <InputAdornment position="start"><Lock fontSize="small" color="disabled" /></InputAdornment>,
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton size="small" onClick={() => setShowPassword(s => !s)}>
                                                    {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    }}
                                />
                                <Button
                                    fullWidth variant="contained" type="submit" size="large"
                                    sx={{
                                        mt: 1.25, py: 1.45, fontSize: 15, fontWeight: 800,
                                        letterSpacing: '0.01em', borderRadius: '12px',
                                        boxShadow: '0 12px 26px -12px rgba(4,120,87,0.7)',
                                    }}
                                    disabled={loading}
                                >
                                    {loading ? 'Signing in…' : 'Sign in'}
                                </Button>
                            </form>

                            <Box sx={{ mt: 2.5, textAlign: 'center' }}>
                                <Link
                                    component="button"
                                    variant="body2"
                                    underline="hover"
                                    onClick={() => setForgotOpen(true)}
                                    sx={{ fontWeight: 600 }}
                                >
                                    Forgot password?
                                </Link>
                                <PoweredBy sx={{ pt: 3, pb: 0 }} />
                            </Box>
                        </Box>
                    </Grid>
                </Grid>
            </Paper>



            <ForgotPasswordDialog
                open={forgotOpen || mustReset}
                forced={mustReset}
                initialUsername={username}
                onClose={() => { setForgotOpen(false); setMustReset(false); }}
                onDone={() => { setMustReset(false); setError(''); setPassword(''); }}
            />
        </Box>
    );
};

export default Login;
