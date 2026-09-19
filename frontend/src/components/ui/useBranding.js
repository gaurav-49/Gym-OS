// frontend/src/components/ui/useBranding.js
// The gym's own name, logo and contact details.
//
// The product is sold to many gyms, so nothing gym-facing is hard-coded any
// more: the sidebar, the login screen, the member portal and the printed
// invoice all read from here. "GYM OS" survives only as the small
// "Powered by" line, which a gym can switch off.
//
//   const brand = useBranding();
//   <Typography>{brand.name}</Typography>
//
// The server is the source of truth: it reads branding.properties (the file a
// reseller edits per gym) and layers any admin edits from the database on top.
//
// Fetched once per page load and cached on the module, because it is needed by
// the very first screen (login) and never changes mid-session. The last known
// values are also kept in localStorage, so a returning visitor paints the
// gym's own name immediately instead of flashing the generic placeholder for
// the length of one request — on the login screen of a gym that has paid to be
// white-labelled, that flash is the one thing that must not happen.

import { useEffect, useState } from 'react';
import api from '../../api';

// Only what renders on a very first visit with a cold cache, or if the call
// fails outright. Never a blank header.
export const DEFAULT_BRANDING = {
    name: 'GYM OS',
    tagline: 'Management System',
    quote: '',
    logo: '🏋️',
    colour: '#059669',
    phone: '',
    email: '',
    address: '',
    website: '',
    gstin: '',
    receipt_note: '',
    powered_by: true,
};

const STORAGE_KEY = 'gym_branding';

const remembered = () => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...DEFAULT_BRANDING, ...JSON.parse(raw) } : null;
    } catch {
        // Private windows and blocked site data both land here; the fetch is
        // still on its way, so this is a nicety, not the mechanism.
        return null;
    }
};

const remember = (value) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch { /* storage full or blocked — the fetch still populated the page */ }
};

let cache = remembered();
let inFlight = null;
const listeners = new Set();

const publish = (value) => {
    cache = value;
    listeners.forEach(fn => fn(value));
};

/** Re-fetch after an admin edits the branding, so every screen updates at once. */
export const refreshBranding = async () => {
    inFlight = null;
    return load();
};

const load = () => {
    // A remembered value paints instantly but is still refreshed underneath —
    // otherwise a gym that renames itself would keep its old name on every
    // browser that had visited before.
    if (!inFlight) {
        inFlight = api.get('/branding')
            .then(res => {
                const value = { ...DEFAULT_BRANDING, ...(res.data || {}) };
                remember(value);
                publish(value);
                return value;
            })
            .catch(() => {
                // A gym with an unreachable backend still gets a labelled UI —
                // its own name if this browser has seen it before.
                const fallback = cache || DEFAULT_BRANDING;
                publish(fallback);
                return fallback;
            });
    }
    return inFlight;
};

const useBranding = () => {
    const [brand, setBrand] = useState(() => cache || remembered() || DEFAULT_BRANDING);

    useEffect(() => {
        let alive = true;
        const listener = (value) => { if (alive) setBrand(value); };
        listeners.add(listener);
        load().then(listener);
        return () => { alive = false; listeners.delete(listener); };
    }, []);

    return brand;
};

export default useBranding;
