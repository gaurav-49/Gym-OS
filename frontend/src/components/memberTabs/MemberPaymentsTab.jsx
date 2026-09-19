// frontend/src/components/memberTabs/MemberPaymentsTab.jsx
import React, { useEffect, useState } from 'react';
import { Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import Alerts from '../Alerts';
import api from '../../api';
import { log, logError } from '../../logger';

const MemberPaymentsTab = ({ memberId, isAdmin }) => {
    const [rows, setRows] = useState([]);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!memberId) return;
        log('MemberPaymentsTab', 'load', `→ load payments for member ${memberId}`);
        api.get('/payments', { params: { member_id: memberId } })
            .then(res => { setRows(res.data); setError(''); })
            .catch(err => {
                logError('MemberPaymentsTab', 'load', `✗ failed for member ${memberId}: ${err.response?.data?.error || err.message}`, err);
                setError(err.response?.data?.error || 'Failed to load payment history.');
            });
    }, [memberId]);

    const total = rows.reduce((s, p) => s + Number(p.amount), 0);

    return (
        <TableContainer>
            <Alerts sx={{ mb: 1 }} items={[error && { severity: 'error', text: error }]} />
            <Typography variant="body2" sx={{ mb: 1 }}>
                Total paid: <strong>₹{total.toLocaleString()}</strong>
            </Typography>
            <Table size="small">
                <TableHead>
                    <TableRow>
                        <TableCell>Amount</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell>Note</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map(p => (
                        <TableRow key={p.id}>
                            <TableCell>₹{Number(p.amount).toLocaleString()}</TableCell>
                            <TableCell>{p.payment_date}</TableCell>
                            <TableCell>{p.method}</TableCell>
                            <TableCell>{p.note || '—'}</TableCell>
                        </TableRow>
                    ))}
                    {rows.length === 0 && (
                        <TableRow><TableCell colSpan={4} align="center">No payments yet.</TableCell></TableRow>
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default MemberPaymentsTab;
