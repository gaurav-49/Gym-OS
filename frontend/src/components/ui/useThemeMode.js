// frontend/src/components/ui/useThemeMode.js
// Light or dark, for both apps.
//
// Three values, not two. "system" means follow the device — it is a choice
// somebody makes, reachable only by asking for it. It is NOT what a new
// account starts on: the default is the app's own theme (`fallback`), so a
// person who has never touched the setting sees the same thing on every
// machine they sit down at, rather than whatever that machine's OS happens to
// be set to.
//
// The choice is stored on the server (clients.theme_preference /
// users.theme_preference) so it follows a person between their phone and the
// desk machine. It is ALSO mirrored into localStorage, for one reason only:
// the first paint. The server value arrives a round trip after the page does,
// and repainting a dark app white for 300ms is worse than any of this is
// worth. localStorage is the cache; the server is the truth.
//
// The cache belongs to the BROWSER, not to the account, which is why `reset`
// exists and logout calls it. Two trainers share the desk machine: without
// that, the second one signs in, has no stored preference of their own, and
// the first one's theme survives — `adopt` had nothing to adopt, so it left
// the cache alone. Clearing on the way out means the next person starts at the
// default and their own choice lands a round trip later.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const VALID = new Set(['light', 'dark', 'system']);

const readStored = (key) => {
    try {
        const v = localStorage.getItem(key);
        return VALID.has(v) ? v : null;
    } catch {
        // Private mode, or storage disabled. Not a reason to fail to render.
        return null;
    }
};

const writeStored = (key, value) => {
    try {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch { /* see above */ }
};

const systemPrefersDark = () => {
    try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
        return false;
    }
};

/**
 * @param storageKey  per-app cache key, e.g. 'gym_member_theme'
 * @param save        (choice) => Promise, persists to the server. Optional.
 * @param fallback    'dark' | 'light' — what "system" means if the browser
 *                    cannot tell us. The portal is dark-first, staff is light.
 */
export default function useThemeMode(storageKey, save, fallback = 'light') {
    // `fallback`, not 'system': never having chosen is not the same as asking
    // to follow the device, and only the second one should hand the decision
    // to the OS.
    const [choice, setChoice] = useState(() => readStored(storageKey) || fallback);
    const [systemDark, setSystemDark] = useState(systemPrefersDark);
    // Set the moment this session makes a choice of its own. It guards the
    // reset path below: a PUT that has not landed yet must not be undone by
    // the next read of a server that still says "no preference".
    const chosenHere = useRef(false);

    // Follow the device live: a phone switching to dark at sunset should take
    // the app with it, without a reload, for anyone on "system".
    useEffect(() => {
        let mq;
        try {
            mq = window.matchMedia('(prefers-color-scheme: dark)');
        } catch {
            return undefined;
        }
        const onChange = (e) => setSystemDark(e.matches);
        // Safari < 14 has addListener but not addEventListener here.
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            else if (mq.removeListener) mq.removeListener(onChange);
        };
    }, []);

    const mode = useMemo(() => {
        if (choice === 'light' || choice === 'dark') return choice;
        if (!window.matchMedia) return fallback;
        return systemDark ? 'dark' : 'light';
    }, [choice, systemDark, fallback]);

    // Adopt what the server says. Only used on load, and only when it actually
    // differs — otherwise every /me refresh would stomp a choice the user just
    // made locally but whose PUT has not landed yet.
    const adopt = useCallback((serverValue) => {
        const v = VALID.has(serverValue) ? serverValue : null;
        if (!v) {
            // The account has no preference of its own. Anything in this
            // browser's cache belongs to whoever sat here last, so fall back to
            // the app default — unless this session is the one that just made
            // the choice the server has not heard about yet.
            if (chosenHere.current) return;
            setChoice((current) => {
                if (current === fallback) return current;
                writeStored(storageKey, null);
                return fallback;
            });
            return;
        }
        setChoice((current) => {
            if (current === v) return current;
            writeStored(storageKey, v);
            return v;
        });
    }, [storageKey, fallback]);

    /** Called on logout: the next person at this browser is not this person. */
    const reset = useCallback(() => {
        chosenHere.current = false;
        writeStored(storageKey, null);
        setChoice(fallback);
    }, [storageKey, fallback]);

    const setMode = useCallback((next) => {
        const v = VALID.has(next) ? next : 'system';
        chosenHere.current = true;
        setChoice(v);
        writeStored(storageKey, v);
        // Fire and forget: the theme has already changed on screen, and a
        // failed save is not worth interrupting someone to say so. Worst case
        // the choice is device-local until the next successful save.
        if (save) Promise.resolve(save(v)).catch(() => {});
    }, [storageKey, save]);

    // What the toggle button does next. Two visible states, so "system" resolves
    // to its opposite rather than cycling through a third the user cannot see.
    const toggle = useCallback(() => {
        setMode(mode === 'dark' ? 'light' : 'dark');
    }, [mode, setMode]);

    return { mode, choice, setMode, toggle, adopt, reset };
}
