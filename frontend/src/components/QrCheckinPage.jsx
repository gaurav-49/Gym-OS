// frontend/src/components/QrCheckinPage.jsx
// Front-desk QR check-in: point the camera at the member's QR code (from the
// member portal) to punch their attendance — or type the ID manually. Every
// punch goes through the same gate rules as the fingerprint machine: unknown
// member → locked, expired membership → locked, duplicate → already marked.
import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
    Box, Paper, Typography, Button, Stack, Chip, Avatar, TextField, CircularProgress, } from '@mui/material';
import Alerts from './Alerts';
import { QrCodeScanner, Fingerprint, CheckCircle, Refresh,
} from '@mui/icons-material';
import api from '../api';
import { log, logError } from '../logger';

const QR_PREFIX = 'GYMOS';

const QrCheckinPage = () => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [scanning, setScanning] = useState(false);
    const scanningRef = useRef(false); // mirrors `scanning` for the RAF scan loop
    const [cameraError, setCameraError] = useState('');
    const [scanError, setScanError] = useState('');
    const [result, setResult] = useState(null);      // { type: 'success'|'error'|'duplicate'|'unknown'|'expired'|'inactive', text }
    const [pending, setPending] = useState(null);     // { member_code, name }
    const [manualId, setManualId] = useState('');
    const [busy, setBusy] = useState(false);
    const [members, setMembers] = useState([]);
    const [membersLoaded, setMembersLoaded] = useState(false);

    // Staff member list (for name lookup when a QR is scanned)
    const loadMembers = async () => {
        try {
            log('QrCheckinPage', 'loadMembers', '→ loading member list for QR name lookup');
            const res = await api.get('/clients');
            setMembers(res.data);
            setMembersLoaded(true);
        } catch (err) {
            logError('QrCheckinPage', 'loadMembers', `✗ failed: ${err.response?.data?.error || err.message}`, err);
            setCameraError(err.response?.data?.error || 'Could not load the member list.');
        }
    };
    useEffect(() => { loadMembers(); }, []);

    const lookupName = (code) => {
        const m = members.find(x => String(x.member_code) === String(code));
        return m ? m.name : null;
    };

    const startCamera = async () => {
        setCameraError('');
        setScanError('');
        setResult(null);
        setPending(null);
        if (!navigator.mediaDevices?.getUserMedia) {
            setCameraError('Camera is not available in this browser — use manual entry below.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
            });
            streamRef.current = stream;
            // The <video> element is ALWAYS mounted (hidden until scanning), so
            // it exists right here — attach the stream and start playback while
            // the click is still fresh, with no mount-timing involved.
            const video = videoRef.current;
            if (video) {
                video.srcObject = stream;
                const playPromise = video.play();
                if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
            }
            scanningRef.current = true;
            setScanning(true);
            requestAnimationFrame(tick);
            log('QrCheckinPage', 'startCamera', 'camera stream acquired');
        } catch (err) {
            logError('QrCheckinPage', 'startCamera', `✗ failed: ${err.message}`, err);
            setCameraError('Camera permission denied or unavailable — use manual entry below.');
        }
    };

    const stopCamera = () => {
        scanningRef.current = false;
        setScanning(false);
        // Detach from the element and stop the tracks so the camera light goes
        // off and the device is released for other apps.
        if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            log('QrCheckinPage', 'stopCamera', 'camera stopped');
        }
    };

    const tick = () => {
        if (!scanningRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA || !canvas) {
            requestAnimationFrame(tick);
            return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) {
            const match = String(code.data).match(new RegExp(`^${QR_PREFIX}:(\\d+)$`));
            if (match) {
                handleScan(match[1]);
                return;
            }
        }
        requestAnimationFrame(tick);
    };

    const handleScan = (memberCode) => {
        stopCamera();
        const name = lookupName(memberCode);
        setPending({ member_code: memberCode, name });
        setScanError(name ? '' : `Member ID ${memberCode} isn't in the member list — double-check before punching.`);
    };

    const punch = async (memberId) => {
        setBusy(true);
        setResult(null);
        setScanError('');
        log('QrCheckinPage', 'punch', `→ QR/manual check-in for member_id=${memberId}`);
        try {
            const res = await api.post('/attendance/qr-punch', { member_id: memberId });
            setResult({ type: 'success', text: res.data.message });
            setPending(null);
            setManualId('');
        } catch (err) {
            const status = err.response?.status;
            const msg = err.response?.data?.error || err.response?.data?.message || 'Check-in failed.';
            if (status === 403) setResult({ type: 'expired', text: msg + ' — gate stays locked.' });
            else if (status === 404) setResult({ type: 'unknown', text: msg });
            else if (status === 409) setResult({ type: 'duplicate', text: msg });
            else if (status === 400) setResult({ type: 'inactive', text: msg });
            else setResult({ type: 'error', text: msg });
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => () => stopCamera(), []);

    // Watchdog: if the camera opened (stream is live) but no frames reach the
    // video element — some embedded windows/Electron builds grant the stream
    // but never render it — stop after ~8s and say so, instead of hanging on
    // "Scanning…" forever with the camera light on.
    useEffect(() => {
        if (!scanning) return;
        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (!scanningRef.current) { clearInterval(timer); return; }
            const video = videoRef.current;
            const hasFrames = video && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0;
            if (hasFrames) { clearInterval(timer); return; }
            if (Date.now() - startedAt > 8000) {
                clearInterval(timer);
                stopCamera();
                setCameraError(
                    'The camera opened but no picture is coming through — the feed is blocked by this window ' +
                    'or another app using the camera. Close other apps and try again, or use manual entry below.'
                );
            }
        }, 1000);
        return () => clearInterval(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scanning]);

    const resultColor = {
        success: 'success', duplicate: 'warning', unknown: 'error',
        expired: 'error', inactive: 'error', error: 'error',
    }[result?.type] || 'info';

    return (
        <Box>
            {/* Result banners — side by side when several show at once */}
            <Alerts items={[
                result && { severity: resultColor, text: result.text, onClose: () => setResult(null) },
                scanError && { severity: 'warning', text: scanError, onClose: () => setScanError('') },
                cameraError && { severity: 'error', text: cameraError, onClose: () => setCameraError('') },
            ]} />

            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                {/* Scanner */}
                <Paper elevation={3} sx={{ p: 3 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <QrCodeScanner sx={{ color: 'primary.main' }} />
                        <Typography variant="h6">Scan member QR code</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        Point the camera at the QR code on the member's phone (Member Portal → Overview → QR Check-in).
                    </Typography>

                    <Box sx={{
                        position: 'relative', borderRadius: 3, overflow: 'hidden', bgcolor: '#0f172a',
                        minHeight: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {/* <video> stays mounted even when off (just hidden), so the
                            stream can be attached the instant getUserMedia resolves. */}
                        <video ref={videoRef} playsInline muted
                            style={{ width: '100%', maxHeight: 320, objectFit: 'cover', display: scanning ? 'block' : 'none' }} />
                        <canvas ref={canvasRef} style={{ display: 'none' }} />
                        {scanning && (
                            <>
                                <Box sx={{
                                    position: 'absolute', inset: 0, pointerEvents: 'none',
                                    border: '3px solid rgba(16,185,129,0.7)', borderRadius: 3,
                                    boxShadow: 'inset 0 0 60px rgba(16,185,129,0.25)',
                                }} />
                                <Chip label="Scanning…" size="small"
                                    sx={{ position: 'absolute', top: 10, right: 10, bgcolor: 'rgba(15,23,42,0.85)', color: '#34d399' }} />
                            </>
                        )}
                        {!scanning && (
                            <Box textAlign="center" py={5}>
                                <Fingerprint sx={{ fontSize: 56, color: '#64748b' }} />
                                <Typography variant="body2" sx={{ color: '#94a3b8', mt: 1 }}>
                                    Camera is off
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    <Stack direction="row" spacing={1} mt={2}>
                        {!scanning ? (
                            <Button variant="contained" startIcon={<QrCodeScanner />} onClick={startCamera}>
                                Start camera
                            </Button>
                        ) : (
                            <Button variant="outlined" startIcon={<Refresh />} onClick={stopCamera}>
                                Stop camera
                            </Button>
                        )}
                    </Stack>

                    {/* Pending confirmation */}
                    {pending && (
                        <Box sx={{ mt: 2, p: 2, borderRadius: 2, bgcolor: 'success.softBg', border: '1px solid', borderColor: 'success.light' }}>
                            <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                                <Avatar sx={{ bgcolor: 'primary.main', fontWeight: 700 }}>
                                    {(pending.name || pending.member_code).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                                </Avatar>
                                <Box>
                                    <Typography variant="body2" fontWeight={700}>{pending.name || 'Unregistered member'}</Typography>
                                    <Typography variant="caption" color="text.secondary">Member ID {pending.member_code}</Typography>
                                </Box>
                            </Box>
                            <Stack direction="row" spacing={1}>
                                <Button size="small" variant="contained" color="success" startIcon={<CheckCircle />}
                                    disabled={busy} onClick={() => punch(pending.member_code)}>
                                    {busy ? 'Punching…' : 'Confirm check-in'}
                                </Button>
                                <Button size="small" onClick={() => { setPending(null); startCamera(); }}>Re-scan</Button>
                            </Stack>
                        </Box>
                    )}
                </Paper>

                {/* Manual entry */}
                <Paper elevation={3} sx={{ p: 3, alignSelf: 'start' }}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <Fingerprint sx={{ color: 'primary.main' }} />
                        <Typography variant="h6">Manual entry</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" mb={2}>
                        No camera handy? Type the member ID — the same gate rules apply.
                    </Typography>
                    <Stack spacing={2}>
                        <TextField fullWidth label="Member ID" value={manualId}
                            onChange={e => setManualId(e.target.value.replace(/\D/g, ''))}
                            inputProps={{ inputMode: 'numeric' }}
                            helperText={manualId && lookupName(manualId) ? `✓ ${lookupName(manualId)}` : (manualId ? '⚠ No member with this ID' : '')}
                            FormHelperTextProps={{ sx: manualId && lookupName(manualId) ? { color: 'success.main' } : { color: 'warning.main' } }}
                        />
                        <Button variant="contained" disabled={!manualId || busy} onClick={() => punch(manualId)}>
                            {busy ? 'Checking in…' : 'Check in member'}
                        </Button>
                    </Stack>
                    {membersLoaded && (
                        <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                            {members.length} registered members · scanned codes are validated against this list
                        </Typography>
                    )}
                </Paper>
            </Box>
        </Box>
    );
};

export default QrCheckinPage;
