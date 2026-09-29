# Code_Sync

A real-time collaborative code editor with a VS Code-style workbench interface, real accounts and authentication, and private, password-protected rooms.

Two (or more) people join the same room and write code together, live — with typing synced over WebSockets, syntax highlighting, and one-click code execution powered by Judge0.

## Features

### Editor (VS Code style)
- **Monaco Editor** (the same editor that powers VS Code) with IntelliSense-style suggestions
- **VS Code Dark+ theme** with a full workbench layout:
  - Title bar with file name and room info
  - Activity bar (Explorer / Run) and file Explorer with multiple files per room
  - Editor tabs with dirty (unsaved-changes) indicators
  - Breadcrumbs, minimap, and a bottom output panel
  - Status bar showing language, cursor position, and connection state
- **30+ languages** supported for highlighting and execution (C++, Python, Java, JavaScript, Go, Rust, TypeScript, and more)
- **Real-time collaboration**: every keystroke is broadcast to everyone in the room via Socket.io

### Accounts & authentication
- Register and sign in with **email + password**
- Passwords hashed with **bcrypt** (12 rounds)
- Session **JWTs** with 7-day expiry, stored in `localStorage`
- Protected routes: the dashboard and editor require a signed-in user
- Socket.io handshake authenticates with the JWT — **no token, no connection**
- Your username comes from the **server-verified JWT**, so it can't be spoofed from the client
- Login/register endpoints are **rate-limited** (20 attempts per IP per 15 minutes)

### Rooms
- Create rooms from the dashboard; every room gets a shareable Room ID
- **Optional room passwords** (hashed with bcrypt) for private rooms
- Joining an unknown room ID or entering the wrong password is rejected
- "My rooms" list shows every room you created

### Code execution
- Run button executes code through the **Judge0** API with optional stdin
- Output (stdout / stderr / compile errors / time & memory) appears in the bottom panel
- Authenticated endpoint, rate-limited (30 runs per IP per minute), with source/stdin size limits

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Monaco (`@monaco-editor/react`) |
| Backend | Express, Socket.io, `node:sqlite` (built-in, zero dependencies) |
| Auth | bcryptjs, jsonwebtoken, express-rate-limit |
| Execution | Judge0 CE API via RapidAPI |

## Project structure

```
Code_Sync/
├── server.js              # Express + Socket.io server, room socket logic
├── server/
│   ├── db.js              # SQLite setup (users, rooms tables)
│   └── auth.js            # JWT helpers, auth middleware, rate limiters
├── src/
│   ├── App.jsx            # Routes: / (auth), /home, /editor/:roomId
│   ├── api.js             # Authenticated fetch wrapper for /api
│   ├── socket.js          # Socket.io client (sends JWT on connect)
│   ├── Actions.json       # Socket event names (JOIN, JOINED, CODE_CHANGE, ...)
│   ├── languages.js       # Language list (Judge0 IDs + Monaco IDs)
│   ├── context/
│   │   └── AuthContext.jsx  # Auth state, login/register/logout
│   ├── components/
│   │   ├── ProtectedRoute.jsx # Redirects to / when not signed in
│   │   ├── MonacoEditor.jsx   # Monaco wrapper with vs-dark theme
│   │   └── CodeRunner.jsx     # Run button + output panel
│   ├── pages/
│   │   ├── AuthPage.jsx   # Login / register screen
│   │   ├── Home.jsx       # Dashboard: create rooms, my rooms, join
│   │   └── EditorPage.jsx # VS Code-style workbench
│   ├── vscode.css         # Workbench styling
│   └── index.css          # Global styles
├── .env.example           # Environment variable template
└── package.json
```

## Prerequisites

- **Node.js 22+** (the server uses the built-in `node:sqlite` module, available from Node 22.5).
  Check yours with `node -v`. Download the latest LTS from [nodejs.org](https://nodejs.org).
- **npm** (comes with Node).
- A **Judge0 RapidAPI key** (free tier works) — get one at
  [rapidapi.com/judge0-official](https://rapidapi.com/judge0-official/api/judge0-ce).

## Setup

### 1. Clone and install

```bash
git clone https://github.com/LuciferAvi07/Code_Sync.git
cd Code_Sync
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
# Generate a long random secret and paste it below:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```env
JWT_SECRET=<paste the generated secret here>
PORT=5000
RAPIDAPI_KEY=<your Judge0 RapidAPI key>
```

> `JWT_SECRET` signs session tokens — keep it private and never commit `.env`.
> (`.gitignore` already excludes it and the SQLite database.)

### 3. Run the project

Open **two terminals** (in VS Code: `Terminal → Split Terminal`):

**Terminal 1 — backend (http://localhost:5000):**
```bash
npm run server:dev
```

**Terminal 2 — frontend (http://localhost:5173):**
```bash
npm run start:front
```

Then open **http://localhost:5173** in your browser.

## How to use

1. **Create an account** — register with a name, email, and password (min 8 characters).
2. **Create a room** — click *New Room*, give it a name, and optionally set a room password.
3. **Share the Room ID** — copy it from the dashboard or the editor title bar.
4. **Collaborate** — a second person registers (or opens an incognito window), joins with the Room ID (and password, if set), and you both edit the same code in real time.
5. **Run code** — pick a language, type code (optionally add stdin), and hit the run button. Output appears in the bottom panel.

### npm scripts

| Script | What it does |
|---|---|
| `npm run server:dev` | Start the backend with hot reload (nodemon) |
| `npm run start:front` | Start the Vite dev server |
| `npm run build` | Production build of the frontend |
| `npx vite build` | Same as above (build check) |

## API reference (backend)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register (name, email, password ≥ 8 chars) |
| POST | `/api/auth/login` | — | Login (email, password) |
| GET | `/api/auth/me` | JWT | Current user profile |
| GET | `/api/rooms/mine` | JWT | Rooms created by the user |
| POST | `/api/rooms` | JWT | Create room (name, optional password) |
| POST | `/api/execute` | JWT | Run code via Judge0 |

Socket.io connects to `http://localhost:5000` (proxied to `/socket.io` in dev) with
`auth: { token }`. Events: `join` `{ roomId, password }`, `code-change`, `sync-code`,
`language-change`, `joined`, `join-error`, `disconnected`.

## Security notes

- Passwords are never stored in plain text (bcrypt, 12 rounds).
- JWTs expire after 7 days and are verified on every API call and socket connection.
- Room passwords are hashed; the server only ever compares hashes.
- Auth endpoints are rate-limited to slow down brute-force attempts.
- File contents are kept in the browser (`localStorage`) for now — the database
  stores only users and rooms, not code.

## Known limitations

- Collaboration is **last-writer-wins full-text sync** (no CRDT/operational transforms),
  so simultaneous edits to the same line can overwrite each other.
- There is **no password reset** flow yet.
- Monaco and the file-type icons load from CDNs, so an internet connection is required.

## License

MIT — feel free to fork and build on it.
