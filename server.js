require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { v4: uuidV4 } = require('uuid');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions.json');
const db = require('./server/db');
const { register, login, me, requireAuth, verifyToken } = require('./server/auth');

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        // Restrict in production: set FRONTEND_URL to your deployed origin.
        origin: process.env.FRONTEND_URL || true,
    },
});

app.use(express.json({ limit: '100kb' }));

// ---- Rate limiting -------------------------------------------------------
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 login/register attempts per IP per 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later.' },
});
const executeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 code executions per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many executions, please slow down.' },
});

// ---- Auth API ------------------------------------------------------------
app.post('/api/auth/register', authLimiter, register);
app.post('/api/auth/login', authLimiter, login);
app.get('/api/auth/me', requireAuth, me);

// ---- Rooms API -----------------------------------------------------------
// Rooms are created by signed-in users and may carry an optional password.
// Only the room id is ever shared — never the password hash.
app.post('/api/rooms', requireAuth, async (req, res) => {
    const { name, password } = req.body || {};
    if (name && (typeof name !== 'string' || name.trim().length > 60)) {
        return res.status(400).json({ error: 'Room name is too long.' });
    }
    if (password && (typeof password !== 'string' || password.length < 4 || password.length > 72)) {
        return res.status(400).json({ error: 'Room password must be 4-72 characters.' });
    }
    const room = {
        id: uuidV4(),
        name: name?.trim() || null,
        password_hash: password ? await bcrypt.hash(password, 10) : null,
        owner_id: req.user.sub,
        created_at: new Date().toISOString(),
    };
    db.prepare(
        'INSERT INTO rooms (id, name, password_hash, owner_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(room.id, room.name, room.password_hash, room.owner_id, room.created_at);
    res.status(201).json({
        room: { id: room.id, name: room.name, hasPassword: !!room.password_hash, createdAt: room.created_at },
    });
});

app.get('/api/rooms', requireAuth, (req, res) => {
    const rooms = db
        .prepare(
            'SELECT id, name, password_hash IS NOT NULL AS hasPassword, created_at FROM rooms WHERE owner_id = ? ORDER BY created_at DESC'
        )
        .all(req.user.sub)
        .map((row) => ({
            id: row.id,
            name: row.name,
            hasPassword: !!row.hasPassword,
            createdAt: row.created_at,
        }));
    res.json({ rooms });
});

// ---- Code execution -------------------------------------------------------
const encode = (value = '') => Buffer.from(value, 'utf8').toString('base64');
const decode = (value) =>
    value ? Buffer.from(value, 'base64').toString('utf8') : '';

app.post('/api/execute', requireAuth, executeLimiter, async (req, res) => {
    const { sourceCode, languageId, stdin = '' } = req.body;
    if (typeof sourceCode !== 'string' || !Number.isInteger(languageId)) {
        return res.status(400).json({ error: 'Source code and language are required.' });
    }
    if (sourceCode.length > 100_000 || String(stdin).length > 20_000) {
        return res.status(413).json({ error: 'Submission is too large.' });
    }

    try {
        const judge0Url = process.env.JUDGE0_URL || 'https://ce.judge0.com';
        const response = await fetch(
            `${judge0Url}/submissions?base64_encoded=true&wait=true`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    language_id: languageId,
                    source_code: encode(sourceCode),
                    stdin: encode(String(stdin)),
                }),
            }
        );
        const result = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({
                error: result.message || 'Judge0 rejected the submission.',
            });
        }

        const output = [
            decode(result.stdout),
            decode(result.stderr),
            decode(result.compile_output),
            decode(result.message),
        ]
            .filter(Boolean)
            .join('\n');
        return res.json({ output, status: result.status?.description });
    } catch (error) {
        return res.status(502).json({ error: 'The code execution service is unavailable.' });
    }
});

app.use(express.static('build'));
app.use((req, res, next) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ---- Realtime collaboration ----------------------------------------------
const userSocketMap = {};
function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => ({
            socketId,
            username: userSocketMap[socketId],
        })
    );
}

// Reject socket connections that do not present a valid JWT.
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
        return next(new Error('unauthorized'));
    }
    socket.data.user = payload; // { sub, name, email }
    next();
});

io.on('connection', (socket) => {
    console.log('socket connected', socket.id, 'as', socket.data.user.name);

    socket.on(ACTIONS.JOIN, async ({ roomId, password }) => {
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (!room) {
            socket.emit(ACTIONS.JOIN_DENIED, { reason: 'not-found' });
            return;
        }
        if (room.password_hash) {
            const ok = typeof password === 'string' && (await bcrypt.compare(password, room.password_hash));
            if (!ok) {
                socket.emit(ACTIONS.JOIN_DENIED, { reason: 'wrong-password' });
                return;
            }
        }
        // Identity comes from the verified JWT — clients can no longer spoof usernames.
        const username = socket.data.user.name;
        userSocketMap[socket.id] = username;
        socket.join(roomId);
        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
