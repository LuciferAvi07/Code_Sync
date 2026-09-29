import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react({ include: /\.(js|jsx)$/ })],
    build: {
        outDir: 'build',
    },
    server: {
        // Dev-only: forwards API + websocket traffic to the Express server
        // so `npm run server:dev` + `npm run start:front` work with no extra env.
        proxy: {
            '/api': 'http://localhost:5000',
            '/socket.io': {
                target: 'http://localhost:5000',
                ws: true,
            },
        },
    },
});
