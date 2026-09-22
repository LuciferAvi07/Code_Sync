const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '100kb' }));

const encode = (value = '') => Buffer.from(value, 'utf8').toString('base64');
const decode = (value) =>
    value ? Buffer.from(value, 'base64').toString('utf8') : '';

app.post('/api/execute', async (req, res) => {
    const { sourceCode, languageId, stdin = '' } = req.body;
    if (typeof sourceCode !== 'string' || !Number.isInteger(languageId)) {
        return res.status(400).json({ error: 'Source code and language are required.' });
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
                    stdin: encode(stdin),
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

const userSocketMap = {};
function getAllConnectedClients(roomId) {
    // Map
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => {
            return {
                socketId,
                username: userSocketMap[socketId],
            };
        }
    );
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
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
