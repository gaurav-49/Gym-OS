import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Where `npm run dev` forwards /api. 8080 is the backend's own default
// (server.port in application.yml); set VITE_API_PORT to match SERVER_PORT if
// you moved it. 1.0 read this from backend/.env — that was the Express
// server's port, and 2.0 has no backend/ directory, so the read always failed
// and silently fell back to a port nothing was listening on.
const backendPort = () => process.env.VITE_API_PORT || '8080';

export default defineConfig({
    plugins: [react()],
    // Deploy-time base path: '/' when the WAR is deployed as ROOT.war (the
    // default). Set VITE_BASE=/<context>/ when hosting under a named context
    // (e.g. VITE_BASE=/gymos/ mvn package) so asset URLs match the WAR name.
    base: process.env.VITE_BASE || '/',
    server: {
        proxy: {
            // The frontend calls /api/* and Vite forwards it to the Spring backend.
            '/api': `http://localhost:${backendPort()}`,
        },
    },
});
