// frontend/src/components/ui/usePlans.js
// The gym's membership packages, from the plans master table.
//
// Plan names were hardcoded in MembersPage and LeadsPage, so a gym that added
// its own package could not sell it from either form. This hook is the one
// place the UI asks what plans exist — it falls back to the built-in names
// while the request is in flight or if the endpoint is unavailable.

import { useEffect, useState } from 'react';
import api from '../../api';

// The names the app shipped with, and still the fallback for an unmigrated DB.
export const BUILTIN_PLAN_NAMES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'Custom'];

export const usePlans = ({ activeOnly = true } = {}) => {
    const [plans, setPlans] = useState([]);

    useEffect(() => {
        let alive = true;
        api.get('/plans', { params: activeOnly ? { active: 'true' } : {} })
            .then(res => { if (alive && Array.isArray(res.data)) setPlans(res.data); })
            .catch(() => { /* keep the fallback names below */ });
        return () => { alive = false; };
    }, [activeOnly]);

    const planNames = plans.length ? plans.map(p => p.name) : BUILTIN_PLAN_NAMES;
    const planBy = (name) => plans.find(p => p.name === name) || null;

    return { plans, planNames, planBy };
};

export default usePlans;
