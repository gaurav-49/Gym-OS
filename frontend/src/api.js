// frontend/src/api.js
import axios from 'axios';
import { log, logError } from './logger';

// Relative base URL — the Vite dev server proxies /api to the Express backend.
const api = axios.create({ baseURL: '/api' });

// Every API call is logged (scope = the URL path) so failures can be traced
// end-to-end: frontend action → HTTP request → backend controller method.
const scopeFor = (url) => `api ${String(url || '').split('?')[0]}`;

// Fresh request ID for each HTTP call. crypto.randomUUID needs a secure
// context (https or localhost — the Vite dev server qualifies); fall back to
// a random hex stamp elsewhere.
const makeRequestId = () => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    const rand = Math.random().toString(16).slice(2);
    return `${Date.now().toString(16)}-${rand}`;
};

// Attach the right JWT to every request: member self-service routes
// (/api/member/*) use the member token; everything else uses the staff token.
// Also stamp every request with a fresh request ID so backend logs for the
// same action carry the same rid.
api.interceptors.request.use(config => {
    const isMemberRoute = String(config.url || '').startsWith('/member/');
    const token = isMemberRoute
        ? localStorage.getItem('gym_member_token')
        : localStorage.getItem('gym_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    config._requestId = makeRequestId();
    config.headers['X-Request-ID'] = config._requestId;
    config._startedAt = Date.now();
    log(scopeFor(config.url), (config.method || 'GET').toUpperCase(), `→ request rid=${config._requestId}`, { params: config.params || undefined });
    return config;
});

// The request ID that was sent (or, once the backend echoes it back in the
// response header, the server-side id — they match for browser-originated
// calls, but a proxy/load balancer may rewrite it).
const responseId = (res) =>
    (res && (res.headers && res.headers['x-request-id'])) ||
    (res && res.config && res.config._requestId);

// If a token is rejected (expired/invalid), drop the session and return to login.
// Only applies when the request actually carried a token — a 401 on the login
// call itself (wrong password) must NOT reload the page, or the error alert
// would never be shown. Member routes are handled by the portal itself (it
// clears its own session), so never hard-reload for those.
api.interceptors.response.use(
    res => {
        const ms = res.config._startedAt ? Date.now() - res.config._startedAt : 0;
        log(scopeFor(res.config && res.config.url), (res.config && res.config.method || 'GET').toUpperCase(), `← ${res.status} (${ms}ms) rid=${responseId(res)}`);
        return res;
    },
    err => {
        const cfg = err.config || {};
        const url = cfg.url || '';
        const ms = cfg._startedAt ? Date.now() - cfg._startedAt : 0;
        const status = err.response ? err.response.status : 0;
        const bodyMsg = err.response && err.response.data && (err.response.data.message || err.response.data.error);
        logError(scopeFor(url), (cfg.method || 'GET').toUpperCase(), `✗ ${status} (${ms}ms) rid=${responseId(err.response || { config: cfg })} ${bodyMsg ? '— ' + bodyMsg : ''}`, err);
        if (err.response && err.response.status === 401) {
            const url = String((err.config && err.config.url) || '');
            const carriedToken = !!(err.config && err.config.headers && err.config.headers.Authorization);
            if (url.startsWith('/member/')) {
                localStorage.removeItem('gym_member_token');
                localStorage.removeItem('gym_member_user');
            } else if (carriedToken) {
                localStorage.removeItem('gym_token');
                localStorage.removeItem('gym_user');
                window.location.reload();
            }
        }
        return Promise.reject(err);
    }
);

export default api;
