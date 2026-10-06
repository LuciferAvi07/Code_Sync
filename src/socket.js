import { io } from 'socket.io-client';

export const initSocket = () => {
    return io(import.meta.env.VITE_BACKEND_URL || undefined, {
        auth: {
            // The JWT proves who we are; the server rejects connections without one.
            token: localStorage.getItem('code-sync-token'),
        },
        // Do NOT pin 'force new connection': the 0.x spelling is silently ignored
        // by v4, so the "fresh connection" guarantee everyone assumes was never
        // in effect. A fresh socket is created explicitly when needed instead.
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10_000,
        // Reconnecting forever is fine, but the *initial* connect must not hang
        // the UI if the backend is simply not running.
        timeout: 10_000,
    });
};