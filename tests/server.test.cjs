const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { io } = require('socket.io-client');

let server, judge, base, token;
const sockets = [];
const event = (socket, name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out waiting for ${name}`)); }, 4000);
    const handler = (data) => { clearTimeout(timer); resolve(data); };
    socket.once(name, handler);
});
const api = async (path, body, auth = token) => {
    const response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
};
const room = async (password) => (await api('/api/rooms', { name: 'Regression room', password })).data.room.id;
const connect = async (roomId, password) => {
    const socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    await event(socket, 'connect');
    if (roomId) {
        const synced = event(socket, 'sync-files');
        socket.emit('join', { roomId, password });
        await synced;
    }
    return socket;
};
const snapshot = async (socket, roomId) => {
    const synced = event(socket, 'sync-files');
    socket.emit('join', { roomId });
    return synced;
};

before(async () => {
    judge = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            const body = JSON.parse(raw);
            if (body.language_id === 999) { res.writeHead(401); res.end(JSON.stringify({ message: 'Upstream auth failed' })); return; }
            if (body.language_id === 998) { res.end(JSON.stringify({ status: { id: 5, description: 'Time Limit Exceeded' } })); return; }
            res.end(JSON.stringify({ token: 'queued-result' }));
        } else {
            res.end(JSON.stringify({ stdout: Buffer.from('finished\n').toString('base64'), status: { id: 3, description: 'Accepted' }, time: '0.01', memory: 1024 }));
        }
    }).listen(0, '127.0.0.1');
    await once(judge, 'listening');
    server = spawn(process.execPath, ['server.js'], {
        cwd: require('node:path').join(__dirname, '..'),
        env: { ...process.env, PORT: '0', DATABASE_PATH: ':memory:', JWT_SECRET: 'isolated-regression-test-secret', JUDGE0_URL: `http://127.0.0.1:${judge.address().port}`, FRONTEND_URL: 'http://frontend.test' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    server.stderr.on('data', (data) => { logs += data; });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Server startup failed: ${logs}`)), 10000);
        server.stdout.on('data', (data) => {
            const port = String(data).match(/Listening on port (\d+)/)?.[1];
            if (port) { clearTimeout(timer); base = `http://127.0.0.1:${port}`; resolve(); }
        });
        server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
    });
    const account = await api('/api/auth/register', { name: 'Tester', email: 'tester@example.test', password: 'test-password' }, null);
    assert.equal(account.status, 201);
    token = account.data.token;
});

after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
    judge?.close();
});

test('invalid credentials return JSON errors without crashing the server', async () => {
    for (const body of [
        { name: 42, email: 'a@example.test', password: 'test-password' },
        { name: 'Valid', email: {}, password: 'test-password' },
        { name: 'Valid', email: 'a@example.test', password: [] },
        { name: 'Valid', email: 'a@example.test', password: 'é'.repeat(40) },
    ]) assert.equal((await api('/api/auth/register', body, null)).status, 400);
    assert.equal((await api('/api/auth/me')).status, 200);
});

test('concurrent duplicate registration returns conflict rather than crashing', async () => {
    const body = { name: 'Race', email: 'race@example.test', password: 'test-password' };
    const responses = await Promise.all([api('/api/auth/register', body, null), api('/api/auth/register', body, null)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
});

test('login remains compatible with older multibyte bcrypt passwords', async () => {
    // Older registrations accepted >72 bytes. Bcrypt stored the same hash as
    // the first 72 bytes, so new-account validation must not lock those users out.
    const prefix = 'é'.repeat(36);
    await api('/api/auth/register', { name: 'Legacy', email: 'legacy@example.test', password: prefix }, null);
    const response = await api('/api/auth/login', { email: 'legacy@example.test', password: `${prefix}legacy` }, null);
    assert.equal(response.status, 200);
});

test('invalid room field types and malformed JSON are handled', async () => {
    for (const body of [{ name: false }, { name: 0 }, { password: [] }, { password: 0 }]) {
        assert.equal((await api('/api/rooms', body)).status, 400);
    }
    const response = await fetch(`${base}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/);
    assert.equal((await api('/api/unknown')).status, 404);
});

test('configured cross-origin API preflight permits authorization', async () => {
    const response = await fetch(`${base}/api/rooms`, { method: 'OPTIONS', headers: { Origin: 'http://frontend.test' } });
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://frontend.test');
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
});

test('execution polls queued submissions and accepts the advertised source/stdin size', async () => {
    const response = await api('/api/execute', { sourceCode: '"'.repeat(100000), stdin: 'x'.repeat(20000), languageId: 63 });
    assert.equal(response.status, 200);
    assert.equal(response.data.output, 'finished\n');
    assert.equal(response.data.time, '0.01');
    assert.equal(response.data.statusId, 3);
    assert.equal((await api('/api/execute', { sourceCode: 'x'.repeat(100001), languageId: 63 })).status, 413);
});

test('execution retains failure status and distinguishes upstream auth from session auth', async () => {
    assert.equal((await api('/api/execute', { sourceCode: '', languageId: 999 })).status, 502);
    const response = await api('/api/execute', { sourceCode: '', languageId: 998 });
    assert.equal(response.data.statusId, 5);
    assert.equal(response.data.status, 'Time Limit Exceeded');
});

test('password gates and malformed socket events do not grant access or crash', async () => {
    const id = await room('room-password');
    const socket = await connect();
    const denied = event(socket, 'join-denied');
    socket.emit('join', { roomId: id, password: 'wrong' });
    assert.equal((await denied).reason, 'wrong-password');
    const error = event(socket, 'error');
    socket.emit('file-created', { roomId: socket.id, path: 'unauthorized.js', kind: 'file' });
    assert.match((await error).message, /Join/);
    const malformed = event(socket, 'error');
    socket.emit('code-change', null);
    assert.match((await malformed).message, /Invalid/);
    const joined = event(socket, 'sync-files');
    socket.emit('join', { roomId: id, password: 'room-password' });
    assert.equal((await joined).files.length, 1);
});

test('late code changes cannot resurrect a deleted file', async () => {
    const id = await room();
    const a = await connect(id);
    const b = await connect(id);
    const created = event(b, 'file-created');
    a.emit('file-created', { roomId: id, path: 'temp.py', kind: 'file', content: 'original' });
    await created;
    const deleted = event(a, 'file-deleted');
    b.emit('file-deleted', { roomId: id, path: 'temp.py' });
    await deleted;
    const rejected = event(a, 'sync-files');
    a.emit('code-change', { roomId: id, path: 'temp.py', code: 'late edit' });
    assert.deepEqual((await rejected).files.map((file) => file.path), ['main.js']);
});

test('server rejects file/folder and ancestor collisions with canonical reconciliation', async () => {
    const id = await room();
    const socket = await connect(id);
    for (const [type, payload] of [
        ['file-created', { path: 'main.js/nested.js', kind: 'file' }],
        ['folder-created', { path: 'main.js/nested', kind: 'folder' }],
        ['file-created', { path: 'x'.repeat(201), kind: 'file' }],
    ]) {
        const synced = event(socket, 'sync-files');
        socket.emit(type, { roomId: id, ...payload });
        assert.deepEqual((await synced).files.map((file) => file.path), ['main.js']);
    }
    socket.emit('folder-created', { roomId: id, path: 'src', kind: 'folder' });
    const synced = event(socket, 'sync-files');
    socket.emit('file-created', { roomId: id, path: 'src', kind: 'file' });
    assert.deepEqual((await synced).folders, ['src']);
});

test('last-file rejection reconciles the sender and wildcard folder deletion is literal', async () => {
    const id = await room();
    const socket = await connect(id);
    const rejected = event(socket, 'sync-files');
    socket.emit('file-deleted', { roomId: id, path: 'main.js' });
    assert.equal((await rejected).files.length, 1);
    socket.emit('file-created', { roomId: id, path: 'a_b/test.js', kind: 'file' });
    socket.emit('file-created', { roomId: id, path: 'axb/test.js', kind: 'file' });
    socket.emit('folder-deleted', { roomId: id, path: 'a_b' });
    assert.deepEqual((await snapshot(socket, id)).files.map((file) => file.path), ['axb/test.js', 'main.js']);
});
