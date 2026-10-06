// SQLite storage for users + rooms. Uses the built-in node:sqlite module,
// so there are no native dependencies to compile.
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DATABASE_PATH || path.join(__dirname, 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
// SQLite ignores foreign keys unless this is switched on per connection, so the
// rooms -> users cascade in the schema below was silently inert.
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT,
    password_hash TEXT,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Server-authoritative file state per room. This is what makes files created
-- by one user appear in every other user's explorer: the database (not each
-- browser's localStorage) is the source of truth, and every file/folder
-- mutation is broadcast to the room over Socket.io.
CREATE TABLE IF NOT EXISTS room_files (
    room_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (room_id, path)
);

CREATE TABLE IF NOT EXISTS room_folders (
    room_id TEXT NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY (room_id, path)
);
`);

module.exports = db;
