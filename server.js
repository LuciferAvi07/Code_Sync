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
// `origin: true` reflects whatever Origin header the caller sends, which lets any
// site on the internet open an authenticated socket against this server. Tokens
// live in localStorage so a cross-origin *read* is still impossible, but the
// handshake itself should only be accepted from origins we know about.
const allowedOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const io = new Server(server, {
    cors: {
        // Same-origin (production build) and the Vite dev server are allowed by
        // default; add real origins via FRONTEND_URL in deployment.
        origin: allowedOrigins.length
            ? allowedOrigins
            : ['http://localhost:5173', 'http://127.0.0.1:5173', `http://localhost:${process.env.PORT || 5000}`],
    },
});

// The editor accepts 100,000 characters plus stdin. JSON escaping and UTF-8
// can make the request substantially larger than the source text itself.
app.use(express.json({ limit: '1mb' }));
const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
};

app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.vary('Origin');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

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
app.post('/api/auth/register', authLimiter, asyncRoute(register));
app.post('/api/auth/login', authLimiter, asyncRoute(login));
app.get('/api/auth/me', requireAuth, me);

// ---- Rooms API -----------------------------------------------------------
// Rooms are created by signed-in users and may carry an optional password.
// Only the room id is ever shared — never the password hash.
app.post('/api/rooms', requireAuth, asyncRoute(async (req, res) => {
    const { name, password } = req.body || {};
    if (name != null && (typeof name !== 'string' || name.trim().length > 60)) {
        return res.status(400).json({ error: 'Room name must be a string of at most 60 characters.' });
    }
    if (password != null && password !== '' &&
        (typeof password !== 'string' || password.length < 4 || Buffer.byteLength(password, 'utf8') > 72)) {
        return res.status(400).json({ error: 'Room password must be at least 4 characters and at most 72 UTF-8 bytes.' });
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
}));

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

// Judge0 can hang indefinitely (overload, network stall). Without a deadline the
// incoming request is held open until Node's own socket timeout, tying up an
// executeLimiter slot the whole time.
const EXECUTE_TIMEOUT_MS = Number(process.env.EXECUTE_TIMEOUT_MS || 20_000);

app.post('/api/execute', requireAuth, executeLimiter, asyncRoute(async (req, res) => {
    const { sourceCode, languageId, stdin = '' } = req.body || {};
    if (typeof sourceCode !== 'string' || !Number.isInteger(languageId) || languageId < 1 || typeof stdin !== 'string') {
        return res.status(400).json({ error: 'Source code and language are required.' });
    }
    if (sourceCode.length > 100_000 || String(stdin).length > 20_000) {
        return res.status(413).json({ error: 'Submission is too large.' });
    }

    try {
        const judge0Url = (process.env.JUDGE0_URL || 'https://ce.judge0.com').replace(/\/$/, '');
        const signal = AbortSignal.timeout(EXECUTE_TIMEOUT_MS);
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
                signal,
            }
        );
        let result = await response.json().catch(() => ({}));
        if (!response.ok) {
            return res.status(502).json({
                error: result.message || 'Judge0 rejected the submission.',
            });
        }

        // Some Judge0 deployments return a token even with wait=true.
        while (result.token && (!result.status || result.status.id <= 2)) {
            await require('node:timers/promises').setTimeout(250, undefined, { signal });
            const poll = await fetch(`${judge0Url}/submissions/${encodeURIComponent(result.token)}?base64_encoded=true`, { signal });
            if (!poll.ok) throw new Error('Could not retrieve execution result');
            result = { ...await poll.json(), token: result.token };
        }
        if (!result.status || result.status.id <= 2) throw new Error('Missing execution result');

        const output = [
            decode(result.stdout),
            decode(result.stderr),
            decode(result.compile_output),
            decode(result.message),
        ]
            .filter(Boolean)
            .join('\n');
        return res.json({ output, status: result.status.description, statusId: result.status.id, time: result.time, memory: result.memory });
    } catch (error) {
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        return res.status(502).json({
            error: timedOut
                ? 'The code execution service took too long to respond.'
                : 'The code execution service is unavailable.',
        });
    }
}));

// Resolve the build directory from this file, not from process.cwd(). A
// CWD-relative path silently 404s every hashed asset when the server is started
// from anywhere else (process manager, `node /abs/path/server.js`, Docker), and
// the SPA fallback below then answers the asset request with index.html — the
// browser gets HTML for a module script and the app never boots.
const buildDir = path.join(__dirname, 'build');

app.use(express.static(buildDir));

// Unknown /api/* paths must be a JSON 404, not the SPA shell. Falling through to
// index.html returns HTTP 200 + text/html, which makes the client's res.json()
// throw and hides the real error behind "Request failed (200)".
app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown endpoint: ${req.method} ${req.originalUrl}` });
});

app.use((req, res, next) => {
    res.sendFile(path.join(buildDir, 'index.html'));
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON request body.' : 'An unexpected server error occurred.' });
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
        if (!segment) continue;
        if (segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment)) return null;
        parts.push(segment);
    }
    if (!parts.length) return null;
    const clean = parts.join('/');
    return clean.length > 200 ? null : clean;
}

const isFilePath = (cleanPath) => cleanPath.split('/').pop().includes('.');

// Clients label their intent explicitly with `kind`. Sniffing the last segment
// for a "." is wrong for legitimate folder names like "v1.0" or "release.2":
// they were read as files, rejected server-side, and then vanished from the
// explorer on the next SYNC_FILES. `kind` is authoritative; the sniff is only a
// fallback for clients that omit it.
function classifyEntry(cleanPath, kind) {
    if (kind === 'file') return 'file';
    if (kind === 'folder') return 'folder';
    return isFilePath(cleanPath) ? 'file' : 'folder';
}

const ancestorFolderPaths = (cleanPath) => {
    const segments = cleanPath.split('/');
    segments.pop();
    const out = [];
    for (let i = 1; i <= segments.length; i++) out.push(segments.slice(0, i).join('/'));
    return out;
};

// SQL LIKE treats "%" and "_" as wildcards, so a raw `${path}/%` pattern makes
// deleting folder "a_b" also wipe "axb/...". Escape the metacharacters (and the
// escape character itself) and pair every LIKE with `ESCAPE '\'` — without an
// ESCAPE clause SQLite has no way to treat a literal backslash as a backslash.
const escapeLikePattern = (value) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const descendantLikePattern = (cleanPath) => `${escapeLikePattern(cleanPath)}/%`;

// ---- Prepared statements ---------------------------------------------------
// `db.prepare()` re-parses and re-plans its SQL on every call. CODE_CHANGE
// arrives once per keystroke from every client in the room, so preparing inside
// the handler meant re-compiling the same statement thousands of times a minute.
// These are compiled once at startup.
const SQL = {
    updateFile: db.prepare('UPDATE room_files SET content = ?, updated_at = ? WHERE room_id = ? AND path = ?'),
    insertFile: db.prepare(
        'INSERT OR IGNORE INTO room_files (room_id, path, content, updated_at) VALUES (?, ?, ?, ?)'
    ),
    insertFolder: db.prepare(
        'INSERT OR IGNORE INTO room_folders (room_id, path) VALUES (?, ?)'
    ),
    hasFile: db.prepare('SELECT 1 FROM room_files WHERE room_id = ? AND path = ?'),
    hasFolder: db.prepare('SELECT 1 FROM room_folders WHERE room_id = ? AND path = ?'),
    countRoomFiles: db.prepare('SELECT COUNT(*) AS n FROM room_files WHERE room_id = ?'),
    deleteFile: db.prepare('DELETE FROM room_files WHERE room_id = ? AND path = ?'),
    countFilesOutsideSubtree: db.prepare(
        `SELECT COUNT(*) AS n FROM room_files
         WHERE room_id = ? AND NOT (path = ? OR path LIKE ? ESCAPE '\\')`
    ),
    deleteSubtreeFiles: db.prepare(
        `DELETE FROM room_files
         WHERE room_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`
    ),
    deleteSubtreeFolders: db.prepare(
        `DELETE FROM room_folders
         WHERE room_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')`
    ),
    listFiles: db.prepare('SELECT path, content FROM room_files WHERE room_id = ? ORDER BY path'),
    listFolders: db.prepare('SELECT path FROM room_folders WHERE room_id = ? ORDER BY path'),
};

function getRoomState(roomId) {
    const files = SQL.listFiles.all(roomId);
    const folders = SQL.listFolders.all(roomId).map((row) => row.path);
    return { files, folders };
}

function sendSyncFiles(socket, roomId) {
    socket.emit(ACTIONS.SYNC_FILES, getRoomState(roomId));
}

function ensureAncestorFolders(roomId, cleanPath) {
    for (const folder of ancestorFolderPaths(cleanPath)) SQL.insertFolder.run(roomId, folder);
}

// ---- Join throttling ------------------------------------------------------
// Every JOIN that reaches a password-protected room runs a bcrypt.compare, and
// the socket handshake is already authenticated — the /api/auth rate limiter
// never touches this path. Without a cap, a single client can guess passwords
// at wire speed. Keyed by address+room so it survives reconnect flapping.
const JOIN_WINDOW_MS = 60_000;
const JOIN_MAX_ATTEMPTS = 10;
const joinAttempts = new Map();

function consumeJoinAttempt(key) {
    const now = Date.now();
    const entry = joinAttempts.get(key);
    if (!entry || now - entry.startedAt > JOIN_WINDOW_MS) {
        joinAttempts.set(key, { startedAt: now, count: 1 });
        if (joinAttempts.size > 5000) {
            for (const [k, v] of joinAttempts) {
                if (now - v.startedAt > JOIN_WINDOW_MS) joinAttempts.delete(k);
            }
        }
        return true;
    }
    entry.count += 1;
    return entry.count <= JOIN_MAX_ATTEMPTS;
}

function clearJoinAttempts(key) {
    joinAttempts.delete(key);
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

// Tell the client a mutation was refused. Returning silently made a rejected
// edit look like it had saved: the local editor showed the new text, the room
// never received it, and the divergence only surfaced on the next reload.
const sendError = (socket, message) => socket.emit(ACTIONS.ERROR, { message });

io.on('connection', (socket) => {
    console.log('socket connected', socket.id, 'as', socket.data.user.name);
    socket.data.joinedRoom = null;

    const rejectMutation = (message) => {
        sendError(socket, message);
        if (socket.data.joinedRoom) sendSyncFiles(socket, socket.data.joinedRoom);
    };
    const onMutation = (event, handler) => socket.on(event, (payload) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return rejectMutation('Invalid room event.');
        }
        if (!socket.data.joinedRoom || payload.roomId !== socket.data.joinedRoom) {
            return sendError(socket, 'Join the room before editing.');
        }
        const cleanPath = normalizeRoomPath(payload.path);
        if (!cleanPath) return rejectMutation('Paths must be 1-200 characters without traversal or control characters.');
        try {
            handler({ ...payload, path: cleanPath });
        } catch (error) {
            console.error(error);
            rejectMutation('The room change could not be saved.');
        }
    });
    const hasFileAncestor = (roomId, cleanPath) =>
        ancestorFolderPaths(cleanPath).some((folder) => SQL.hasFile.get(roomId, folder));

    let joinVersion = 0;
    socket.on(ACTIONS.JOIN, async (payload) => {
        const version = ++joinVersion;
        const { roomId, password } = payload || {};
        if (typeof roomId !== 'string' || !roomId || roomId.length > 100) {
            socket.emit(ACTIONS.JOIN_DENIED, { reason: 'not-found' });
            return;
        }
        try {
            const throttleKey = `${socket.handshake.address}::${roomId}`;

            const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
            if (!room) {
                socket.emit(ACTIONS.JOIN_DENIED, { reason: 'not-found' });
                return;
            }
            if (room.password_hash) {
                if (!consumeJoinAttempt(throttleKey)) {
                    sendError(
                        socket,
                        'Too many join attempts. Wait a minute before trying again.'
                    );
                    socket.emit(ACTIONS.JOIN_DENIED, { reason: 'throttled' });
                    return;
                }
                const ok =
                    typeof password === 'string' && (await bcrypt.compare(password, room.password_hash));
                if (!socket.connected || version !== joinVersion) return;
                if (!ok) {
                    socket.emit(ACTIONS.JOIN_DENIED, { reason: 'wrong-password' });
                    return;
                }
            }
            if (!socket.connected || version !== joinVersion) return;
            clearJoinAttempts(throttleKey);

            const previousRoom = socket.data.joinedRoom;
            if (previousRoom && previousRoom !== roomId) {
                socket.in(previousRoom).emit(ACTIONS.DISCONNECTED, { socketId: socket.id, username: socket.data.user.name });
                socket.leave(previousRoom);
            }

            // Older databases can contain rooms created before file persistence.
            if (!SQL.countRoomFiles.get(roomId).n) {
                SQL.insertFile.run(roomId, 'main.js', "console.log('Hello from main.js');", new Date().toISOString());
            }

            // Identity comes from the verified JWT — clients can no longer spoof usernames.
            const username = socket.data.user.name;
            userSocketMap[socket.id] = username;
            socket.join(roomId);
            socket.data.joinedRoom = roomId;
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
        } catch (error) {
            console.error(error);
            sendError(socket, 'The room could not be joined. Please try again.');
        }
    });

    // Code changes are scoped to a single file path. The sender is excluded
    // from the broadcast (socket.in), so there is no echo, and receivers
    // only touch the file whose path matches.
    onMutation(ACTIONS.CODE_CHANGE, ({ roomId, path, code }) => {
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || classifyEntry(cleanPath, 'file') !== 'file') return;
        if (typeof code !== 'string') return rejectMutation('File content must be text.');
        if (code.length > 100_000) {
            rejectMutation(`${cleanPath} is over the 100,000 character limit; the edit was not shared.`);
            return;
        }
        const result = SQL.updateFile.run(code, new Date().toISOString(), roomId, cleanPath);
        if (!result.changes) {
            return rejectMutation(`${cleanPath} no longer exists. The edit was not shared.`);
        }
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { path: cleanPath, code });
    });

    onMutation(ACTIONS.FILE_CREATED, ({ roomId, path, content, kind }) => {
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || classifyEntry(cleanPath, kind) !== 'file') return rejectMutation('Invalid file path.');
        if (SQL.hasFolder.get(roomId, cleanPath) || hasFileAncestor(roomId, cleanPath)) {
            return rejectMutation('This path conflicts with an existing file or folder.');
        }
        const text = typeof content === 'string' ? content : '';
        if (text.length > 100_000) {
            return rejectMutation(`${cleanPath} is over the 100,000 character limit.`);
        }
        const result = SQL.insertFile.run(roomId, cleanPath, text, new Date().toISOString());
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

    onMutation(ACTIONS.FILE_DELETED, ({ roomId, path }) => {
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || classifyEntry(cleanPath, 'file') !== 'file') return;
        const remaining = SQL.countRoomFiles.get(roomId).n;
        if (remaining <= 1) {
            rejectMutation('A room must keep at least one file.');
            return; // a room must keep at least one file
        }
        SQL.deleteFile.run(roomId, cleanPath);
        socket.in(roomId).emit(ACTIONS.FILE_DELETED, {
            path: cleanPath,
            username: socket.data.user.name,
        });
    });

    onMutation(ACTIONS.FOLDER_CREATED, ({ roomId, path, kind }) => {
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || classifyEntry(cleanPath, kind) !== 'folder') return rejectMutation('Invalid folder path.');
        if (SQL.hasFile.get(roomId, cleanPath) || hasFileAncestor(roomId, cleanPath)) {
            return rejectMutation('This path conflicts with an existing file.');
        }
        ensureAncestorFolders(roomId, `${cleanPath}/placeholder`);
        SQL.insertFolder.run(roomId, cleanPath);
        socket.in(roomId).emit(ACTIONS.FOLDER_CREATED, {
            path: cleanPath,
            folders: getRoomState(roomId).folders,
            username: socket.data.user.name,
        });
    });

    onMutation(ACTIONS.FOLDER_DELETED, ({ roomId, path }) => {
        const cleanPath = normalizeRoomPath(path);
        if (!cleanPath || classifyEntry(cleanPath, 'folder') !== 'folder') return;
        const like = descendantLikePattern(cleanPath);
        const remaining = SQL.countFilesOutsideSubtree.get(roomId, cleanPath, like).n;
        if (remaining < 1) {
            rejectMutation('A room must keep at least one file.');
            return; // a room must keep at least one file
        }
        SQL.deleteSubtreeFiles.run(roomId, cleanPath, like);
        SQL.deleteSubtreeFolders.run(roomId, cleanPath, like);
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
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Listening on port ${server.address().port}`));
