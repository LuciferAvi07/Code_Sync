import { io } from 'socket.io-client';

export const initSocket = async () => {
    const options = {
        'force new connection': true,
        reconnectionAttempt: 'Infinity',
        timeout: 10000,
        transports: ['websocket'],
        // The JWT proves who we are; the server rejects connections without one.
        auth: {
            token: localStorage.getItem('code-sync-token'),
        },
    };
    return io(import.meta.env.VITE_BACKEND_URL || undefined, options);
};
