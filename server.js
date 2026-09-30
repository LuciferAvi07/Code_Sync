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
    // Every room starts with one file, stored server-side so every user who
    // joins sees the same initial explorer state.
    db.prepare(
        'INSERT INTO room_files (room_id, path, content, updated_at) VALUES (?, ?, ?, ?)'
    ).run(room.id, 'main.js', "console.log('Hello from main.js');", room.created_at);
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
// Files are synced per PATH, not per room. Every code change carries the file
// it belongs to, so one user's edits can never land in another user's open
// file. The database holds the canonical file/folder state for each room;
// clients receive it on join (SYNC_FILES) and get every later mutation
// (create/delete) broadcast to the room.
const userSocketMap = {};
function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => ({
            socketId,
            username: userSocketMap[socketId],
        })
    );
}

// Normalize a client-supplied file/folder path: forward slashes only, no
// leading slash, no "." / ".." segments, max 200 chars. Returns null when
// the path is unusable.
function normalizeRoomPath(input) {
    if (typeof input !== 'string') return null;
    const parts = [];
    for (const segment of input.replace(/\\/g, '/').trim().split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') return null;
        parts.push(segment);
    }
    if (!parts.length) return null;
    const clean = parts.join('/');
    return clean.length > 200 ? null : clean;
}

const isFilePath = (cleanPath) => cleanPath.split('/').pop().includes('.');

const ancestorFolderPaths = (cleanPath) => {
    const segments = cleanPath.split('/');
    segments.pop();
    const out = [];
    for (let i = 1; i <= segments.length; i++) out.push(segments.slice(0, i).join('/'));
    return out;
};

function getRoomState(roomId) {
    const files = db
        .prepare('SELECT path, content FROM room_files WHERE room_id = ? ORDER BY path')
        .all(roomId);
    const folders = db
        .prepare('SELECT path FROM room_folders WHERE room_id = ? ORDER BY path')
        .all(roomId)
        .map((row) => row.path);
    return { files, folders };
}

function sendSyncFiles(socket, roomId) {
    socket.emit(ACTIONS.SYNC_FILES, getRoomState(roomId));
}

function ensureAncestorFolders(roomId, cleanPath) {
    const stmt = db.prepare('INSERT OR IGNORE INTO room_folders (room_id, path) VALUES (?, ?)');
    for (const folder of ancestorFolderPaths(cleanPath)) stmt.run(roomId, folder);
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
        // The joiner gets the canonical file/folder state; this is how a
        // second user sees files created by the first user.
        sendSyncFiles(socket, roomId);
    });

    // Code changes are scoped to a single file path. The sender is excluded
    // from the broadcast (socket.in), so there is no echo, and receivers
    // only touch the file whose path matches.
    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, path, code }) => {
        if (!socket.rooms.has(roomId)) return;
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || !isFilePath(cleanPath)) return;
        if (typeof code !== 'string' || code.length > 100_000) return;
        db.prepare(
            `INSERT INTO room_files (room_id, path, content, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(room_id, path)
             DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
        ).run(roomId, cleanPath, code, new Date().toISOString());
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { path: cleanPath, code });
    });

    socket.on(ACTIONS.FILE_CREATED, ({ roomId, path, content }) => {
        if (!socket.rooms.has(roomId)) return;
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || !isFilePath(cleanPath)) return;
        const text = typeof content === 'string' ? content.slice(0, 100_000) : '';
        const result = db
            .prepare(
                'INSERT OR IGNORE INTO room_files (room_id, path, content, updated_at) VALUES (?, ?, ?, ?)'
            )
            .run(roomId, cleanPath, text, new Date().toISOString());
        if (result.changes === 0) {
            // A file with this path already exists — reconcile the sender
            // with the canonical state instead of forking it.
            sendSyncFiles(socket, roomId);
            return;
        }
        ensureAncestorFolders(roomId, cleanPath);
        socket.in(roomId).emit(ACTIONS.FILE_CREATED, {
            path: cleanPath,
            content: text,
            folders: getRoomState(roomId).folders,
            username: socket.data.user.name,
        });
    });

    socket.on(ACTIONS.FILE_DELETED, ({ roomId, path }) => {
        if (!socket.rooms.has(roomId)) return;
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || !isFilePath(cleanPath)) return;
        const remaining = db
            .prepare('SELECT COUNT(*) AS n FROM room_files WHERE room_id = ?')
            .get(roomId).n;
        if (remaining <= 1) return; // a room must keep at least one file
        db.prepare('DELETE FROM room_files WHERE room_id = ? AND path = ?').run(
            roomId,
            cleanPath
        );
        socket.in(roomId).emit(ACTIONS.FILE_DELETED, {
            path: cleanPath,
            username: socket.data.user.name,
        });
    });

    socket.on(ACTIONS.FOLDER_CREATED, ({ roomId, path }) => {
        if (!socket.rooms.has(roomId)) return;
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || isFilePath(cleanPath)) return;
        const clash = db
            .prepare('SELECT 1 FROM room_files WHERE room_id = ? AND path = ?')
            .get(roomId, cleanPath);
        if (clash) {
            sendSyncFiles(socket, roomId);
            return;
        }
        ensureAncestorFolders(roomId, `${cleanPath}/placeholder`);
        db.prepare('INSERT OR IGNORE INTO room_folders (room_id, path) VALUES (?, ?)').run(
            roomId,
            cleanPath
        );
        socket.in(roomId).emit(ACTIONS.FOLDER_CREATED, {
            path: cleanPath,
            folders: getRoomState(roomId).folders,
            username: socket.data.user.name,
        });
    });

    socket.on(ACTIONS.FOLDER_DELETED, ({ roomId, path }) => {
        if (!socket.rooms.has(roomId)) return;
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || isFilePath(cleanPath)) return;
        const like = `${cleanPath}/%`;
        const remaining = db
            .prepare(
                'SELECT COUNT(*) AS n FROM room_files WHERE room_id = ? AND NOT (path = ? OR path LIKE ?)'
            )
            .get(roomId, cleanPath, like).n;
        if (remaining < 1) return; // a room must keep at least one file
        db.prepare(
            'DELETE FROM room_files WHERE room_id = ? AND (path = ? OR path LIKE ?)'
        ).run(roomId, cleanPath, like);
        db.prepare(
            'DELETE FROM room_folders WHERE room_id = ? AND (path = ? OR path LIKE ?)'
        ).run(roomId, cleanPath, like);
        socket.in(roomId).emit(ACTIONS.FOLDER_DELETED, {
            path: cleanPath,
            username: socket.data.user.name,
        });
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
