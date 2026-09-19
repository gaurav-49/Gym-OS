// frontend/src/logger.js
// Shared structured logger for the whole frontend. Every line prints with a
// timestamp, scope (module/page) and method so failures can be traced to the
// exact component action without manual debugging.
//
// Usage:
//   import { log, logError } from '../logger';
//   log('MembersPage', 'handleSave', 'Saving member', { id: 42 });
//   logError('MembersPage', 'handleSave', 'Failed to save member', err);

const ts = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

const fmt = (level, scope, method, message) =>
    `[${ts()}] [${level}] [${scope}] ${method} :: ${message}`;

export const log = (scope, method, message, data) => {
    if (data !== undefined) console.log(fmt('INFO', scope, method, message), data);
    else console.log(fmt('INFO', scope, method, message));
};

export const warn = (scope, method, message, data) => {
    if (data !== undefined) console.warn(fmt('WARN', scope, method, message), data);
    else console.warn(fmt('WARN', scope, method, message));
};

export const logError = (scope, method, message, err) => {
    console.error(fmt('ERROR', scope, method, message), err || '');
    if (err && err.stack) console.error(fmt('ERROR', scope, method, 'stack:'), err.stack);
};
