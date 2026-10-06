// Authentication: registration, login, JWT issuance + verification.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidV4 } = require('uuid');
const db = require('./db');

const TOKEN_TTL = '7d';
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'change-me-to-a-long-random-string') {
    throw new Error('Set JWT_SECRET in .env before starting the server.');
}

function signToken(user) {
    return jwt.sign(
        { sub: user.id, name: user.name, email: user.email },
        JWT_SECRET,
        { expiresIn: TOKEN_TTL }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
        return null;
    }
}

function publicUser(row) {
    return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

// Express middleware: rejects requests without a valid Bearer token.
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    req.user = payload;
    next();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials({ name, email, password }, { checkName }) {
    if (checkName && (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 30)) {
        return 'Name must be between 2 and 30 characters.';
    }
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email.trim())) {
        return 'Enter a valid email address.';
    }
    if (typeof password !== 'string' || password.length < 8) {
        return 'Password must be at least 8 characters long.';
    }
    // Enforce bcrypt's byte limit on new accounts. Existing accounts may have
    // been created under the old character-based limit and must still log in.
    if (checkName && Buffer.byteLength(password, 'utf8') > 72) {
        return 'Password must be at most 72 UTF-8 bytes.';
    }
    return null;
}

async function register(req, res) {
    const { name, email, password } = req.body || {};
    const error = validateCredentials({ name, email, password }, { checkName: true });
    if (error) return res.status(400).json({ error });

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db
        .prepare('SELECT id FROM users WHERE email = ?')
        .get(normalizedEmail);
    if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = {
        id: uuidV4(),
        name: name.trim(),
        email: normalizedEmail,
        created_at: new Date().toISOString(),
    };
    const result = db.prepare(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(user.id, user.name, user.email, passwordHash, user.created_at);
    // Another registration may finish hashing while this one awaits bcrypt.
    if (!result.changes) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
}

async function login(req, res) {
    const { email, password } = req.body || {};
    const error = validateCredentials({ email, password }, { checkName: false });
    if (error) return res.status(400).json({ error });

    const row = db
        .prepare('SELECT * FROM users WHERE email = ?')
        .get(email.trim().toLowerCase());
    // Same generic message whether the email or the password is wrong,
    // so attackers cannot enumerate registered emails.
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return res.json({ token: signToken(row), user: publicUser(row) });
}

function me(req, res) {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!row) return res.status(401).json({ error: 'Account no longer exists.' });
    return res.json({ user: publicUser(row) });
}

module.exports = { register, login, me, requireAuth, signToken, verifyToken };
