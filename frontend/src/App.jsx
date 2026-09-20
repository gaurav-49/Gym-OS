// src/App.jsx
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { Box, Typography, useMediaQuery, useTheme, Drawer, IconButton, Tooltip } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { buildTheme } from './theme';
import ThemeToggle from './components/ui/ThemeToggle.jsx';
import useThemeMode from './components/ui/useThemeMode.js';
import { Menu as MenuIcon } from '@mui/icons-material';
import api from './api';
import Login from './components/Login.jsx';
import Sidebar, { SIDEBAR_WIDTH } from './components/Sidebar.jsx';
import StaffNavGrid from './components/StaffNavGrid.jsx';
import DashboardPage from './components/DashboardPage.jsx';
import AttendanceForm from './components/AttendanceForm.jsx';
import AttendanceList from './components/AttendanceList.jsx';
import MembersPage from './components/MembersPage.jsx';
import DevicesPage from './components/DevicesPage.jsx';
import PaymentsPage from './components/PaymentsPage.jsx';
import ReportsPage from './components/ReportsPage.jsx';
import UsersPage from './components/UsersPage.jsx';
import NotificationsPage from './components/NotificationsPage.jsx';
import ClassesPage from './components/ClassesPage.jsx';
import MemberBookingPage from './components/MemberBookingPage.jsx';
import MemberPortal from './components/MemberPortal.jsx';
import QrCheckinPage from './components/QrCheckinPage.jsx';
import BillingPage from './components/BillingPage.jsx';
import LeadsPage from './components/LeadsPage.jsx';
import PlansPage from './components/PlansPage.jsx';
import FinancePage from './components/FinancePage.jsx';
import InvoicesPage from './components/InvoicesPage.jsx';
import StaffPage from './components/StaffPage.jsx';
import PtPage from './components/PtPage.jsx';
import InventoryPage from './components/InventoryPage.jsx';
import LockersPage from './components/LockersPage.jsx';
import BranchesPage from './components/BranchesPage.jsx';
import AuditPage from './components/AuditPage.jsx';
import RetentionPage from './components/RetentionPage.jsx';
import BrandingPage from './components/BrandingPage.jsx';
import useBranding from './components/ui/useBranding';

const PAGE_TITLES = [
    { title: 'Dashboard', subtitle: 'Your gym at a glance' },
    { title: 'Members', subtitle: 'Manage members & memberships' },
    { title: 'Attendance', subtitle: 'Mark and review attendance' },
    { title: 'Classes', subtitle: 'Class scheduling & member bookings' },
    { title: 'Devices', subtitle: 'Biometric terminals & fingerprint punches' },
    { title: 'Payments', subtitle: 'Billing and collections' },
    { title: 'Reports', subtitle: 'Attendance analytics & export' },
    { title: 'Users', subtitle: 'Accounts, roles & permissions' },
    { title: 'Reminders', subtitle: 'Expiry alerts & renewal receipts' },
    { title: 'QR Check-in', subtitle: 'Scan member QR codes at the desk' },
    { title: 'Billing', subtitle: 'Auto-renew & recurring payments' },
    { title: 'Leads', subtitle: 'Walk-in inquiries & conversion' },
    { title: 'Plans', subtitle: 'Membership packages, durations & pricing' },
    { title: 'Finance', subtitle: 'Expenses and profit & loss' },
    { title: 'Invoices', subtitle: 'Numbered tax invoices' },
    { title: 'Staff', subtitle: 'Employee attendance, shifts & payroll' },
    { title: 'Personal Training', subtitle: 'PT packages, sessions & trainer commissions' },
    { title: 'Inventory', subtitle: 'Stock and counter sales' },
    { title: 'Lockers', subtitle: 'Locker assignment & rentals' },
    { title: 'Branches', subtitle: 'Locations and their records' },
    { title: 'Audit Log', subtitle: 'Who changed what, across every module' },
    { title: 'Retention', subtitle: 'Who is about to leave, and why' },
    { title: 'Branding', subtitle: 'The gym name, logo and lines this install shows' },
];

// Tabs that only admins can open (staff never see them in the nav or the page).
const ADMIN_ONLY_TABS = new Set([7, 8, 13, 15, 19, 20, 22]);

const readStoredUser = () => {
    try {
        return JSON.parse(localStorage.getItem('gym_user') || 'null');
    } catch {
        return null;
    }
};

function App() {
    const [user, setUser] = useState(readStoredUser);
    const [tab, setTab] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);
    const [navOpen, setNavOpen] = useState(false);

    // Appearance, stored against the staff account rather than the browser:
    // the desk machine is shared, and localStorage would hand the next person
    // on that terminal the last person's theme. Light-first here — this app is
    // dense tables read all day, not a status screen glanced at for 20 seconds.
    const brand = useBranding();
    const saveTheme = useCallback(
        (choice) => api.put('/auth/preferences', { theme: choice }), []);
    // Dark is the default for an account that has never chosen, in both apps.
    // A person who picks light keeps light — that choice is stored against the
    // account, so it follows them to any machine and survives the next person
    // signing in at this one.
    const { mode: themeMode, toggle: toggleTheme, adopt: adoptTheme, reset: resetTheme } =
        useThemeMode('gym_staff_theme', saveTheme, 'dark');
    const staffTheme = useMemo(() => buildTheme(themeMode), [themeMode]);
    // A lead being converted. Convert does not create anybody on the Leads
    // page any more — it opens the member onboarding form with what the
    // enquiry already told us, and every onboarding rule applies from there.
    const [onboardLead, setOnboardLead] = useState(null);
    // The member routes are hash-based. Without this listener the hash could
    // change (a link, the back button) while React carried on rendering the
    // previous route, because the hash is read during render and nothing
    // marked the component dirty.
    const [hash, setHash] = useState(window.location.hash);
    useEffect(() => {
        const onHashChange = () => setHash(window.location.hash);
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('md'));

    // The page title is the one bit of app state worth putting in the browser
    // chrome — it makes a pinned tab and the back/forward history legible.
    // The vendor's name, in every gym's browser tab and every pinned bookmark.
    // A white-labelled install is not white-labelled if the tab says GYM OS.
    useEffect(() => {
        const page = PAGE_TITLES[tab];
        document.title = user && page ? `${page.title} · ${brand.name}` : brand.name;
    }, [tab, user, brand.name]);

    // The account's own choice, which beats whatever this browser cached — the
    // point of storing it server-side is that it follows the person, not the
    // machine. Silent on failure: an unreachable preference is not a reason to
    // block someone from using the app.
    useEffect(() => {
        if (!user) return;
        let cancelled = false;
        api.get('/auth/preferences')
            .then(res => { if (!cancelled) adoptTheme(res.data?.theme_preference); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [user, adoptTheme]);

    // Public member self-service routes
    //   #/member-booking — class booking (legacy link)
    //   #/member         — full member portal (plan, dues, QR check-in, …)
    if (hash.startsWith('#/member-booking')) {
        return <MemberBookingPage />;
    }
    if (hash.startsWith('#/member')) {
        return <MemberPortal />;
    }

    const handleAttendanceMarked = () => setRefreshKey(k => k + 1);

    const handleLogout = () => {
        localStorage.removeItem('gym_token');
        localStorage.removeItem('gym_user');
        // The cached theme is this browser's, not this account's. Leaving it
        // behind hands the next person at the desk the last one's appearance.
        resetTheme();
        setUser(null);
        setTab(0);
    };

    if (!user) {
        // Inside the ThemeProvider, not outside it. This branch returned bare,
        // so the sign-in screen rendered under main.jsx's default light theme
        // and was the one screen in the staff app that never respected the
        // chosen appearance — which is why it stayed a white slab beside the
        // member portal's door, and why forcing bgcolor on the panel looked
        // like the fix. CssBaseline comes with it so the page ground matches.
        return (
            <ThemeProvider theme={staffTheme}>
                <CssBaseline />
                <Login onLogin={setUser} />
            </ThemeProvider>
        );
    }

    const isAdmin = user.role === 'admin';
    // A non-admin who somehow lands on an admin tab sees the dashboard rather
    // than a blank page.
    const safeTab = (!isAdmin && ADMIN_ONLY_TABS.has(tab)) || (tab === 22 && !brand.branding_enabled)
        ? 0 : tab;
    const page = PAGE_TITLES[safeTab] || PAGE_TITLES[0];

    const navigate = (id) => {
        setTab(id);
        setNavOpen(false);
        // A tall page left scrolled halfway down would otherwise open the next
        // one at the same offset, below its own heading.
        window.scrollTo({ top: 0 });
    };

    const nav = (
        <Sidebar tab={safeTab} onNavigate={navigate} user={user} onLogout={handleLogout} isAdmin={isAdmin} />
    );

    return (
      <ThemeProvider theme={staffTheme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
            {isMobile ? (
                // On a phone the drawer is the whole width and shows every
                // module at once, rather than a 250px column of a 22-row list
                // that has to be scrolled to be discovered.
                <Drawer
                    open={navOpen}
                    onClose={() => setNavOpen(false)}
                    ModalProps={{ keepMounted: true }}
                    PaperProps={{ sx: { width: '100%', maxWidth: 520, border: 0 } }}
                >
                    <StaffNavGrid
                        tab={safeTab}
                        onNavigate={navigate}
                        isAdmin={isAdmin}
                        brandName={brand.name}
                    />
                </Drawer>
            ) : (
                <Box sx={{ position: 'sticky', top: 0, height: '100vh', flexShrink: 0 }}>{nav}</Box>
            )}

            <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
                {/* Top bar — sticky so the page you are on, and the way back to
                    the menu on a phone, are always reachable. */}
                <Box
                    sx={{
                        px: { xs: 2, md: 4 }, py: { xs: 1.5, md: 2.5 },
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        justifyContent: 'space-between',
                        bgcolor: 'background.default',
                        borderBottom: '1px solid', borderColor: 'divider',
                        position: 'sticky', top: 0, zIndex: theme.zIndex.appBar - 1,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                        {isMobile && (
                            <Tooltip title="Menu">
                                <IconButton onClick={() => setNavOpen(true)} edge="start" aria-label="Open navigation">
                                    <MenuIcon />
                                </IconButton>
                            </Tooltip>
                        )}
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h5" noWrap sx={{ lineHeight: 1.2 }}>{page.title}</Typography>
                            <Typography variant="body2" color="text.secondary" noWrap>{page.subtitle}</Typography>
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, whiteSpace: 'nowrap' }}>
                            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                        </Typography>
                        <ThemeToggle mode={themeMode} onToggle={toggleTheme} />
                    </Box>
                </Box>

                {/* Content */}
                <Box sx={{ p: { xs: 2, md: 4 }, flexGrow: 1, minWidth: 0 }}>
                    {safeTab === 0 && <DashboardPage onNavigate={navigate} />}
                    {safeTab === 1 && (
                        <MembersPage
                            isAdmin={isAdmin}
                            onboardLead={onboardLead}
                            onLeadOnboarded={() => setOnboardLead(null)} />
                    )}
                    {safeTab === 2 && (
                        <>
                            <AttendanceForm onAttendanceMarked={handleAttendanceMarked} />
                            <AttendanceList key={refreshKey} />
                        </>
                    )}
                    {safeTab === 3 && <ClassesPage isAdmin={isAdmin} />}
                    {safeTab === 4 && <DevicesPage />}
                    {safeTab === 5 && <PaymentsPage isAdmin={isAdmin} />}
                    {safeTab === 6 && <ReportsPage />}
                    {safeTab === 7 && isAdmin && <UsersPage currentUser={user} />}
                    {safeTab === 8 && isAdmin && <NotificationsPage />}
                    {safeTab === 9 && <QrCheckinPage />}
                    {safeTab === 10 && <BillingPage isAdmin={isAdmin} />}
                    {safeTab === 11 && (
                        <LeadsPage onOnboard={(lead) => { setOnboardLead(lead); navigate(1); }} />
                    )}
                    {safeTab === 12 && <PlansPage isAdmin={isAdmin} />}
                    {safeTab === 13 && isAdmin && <FinancePage />}
                    {safeTab === 14 && <InvoicesPage isAdmin={isAdmin} />}
                    {safeTab === 15 && isAdmin && <StaffPage />}
                    {safeTab === 16 && <PtPage isAdmin={isAdmin} />}
                    {safeTab === 17 && <InventoryPage isAdmin={isAdmin} />}
                    {safeTab === 18 && <LockersPage isAdmin={isAdmin} />}
                    {safeTab === 19 && isAdmin && <BranchesPage isAdmin={isAdmin} />}
                    {safeTab === 20 && isAdmin && <AuditPage />}
                    {safeTab === 21 && <RetentionPage onNavigate={navigate} />}
                    {safeTab === 22 && <BrandingPage />}
                </Box>
            </Box>
        </Box>
      </ThemeProvider>
    );
}

export default App;
