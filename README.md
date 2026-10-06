# Code_Sync

A real-time collaborative code editor with a VS Code-style workbench interface, real accounts and authentication, and private, password-protected rooms.

Two (or more) people join the same room and write code together, live — with typing synced over WebSockets, syntax highlighting, and one-click code execution powered by Judge0.

## Features

### Editor (VS Code style)
- **Monaco Editor** (the same editor that powers VS Code) with IntelliSense-style suggestions
- **Modern VS Code-inspired workbench** with glass tabs and soft, raised controls:
  - Title bar with file name and room info
  - Activity bar (Explorer / Run) and file Explorer with multiple files per room
  - **VS Code-style file/folder creation**: select a folder and use the Explorer
    toolbar, the folder's inline actions, or right-click **New File… / New Folder…**.
    The name field appears directly inside that folder; selecting a file targets
    its parent. Select **ROOM FILES** to create at the room root.
    **Enter** confirms, **Escape** cancels, and clicking away confirms a valid name
    (or discards an empty field). Validation stays inline. Nested paths such as
    `components/Button.jsx`, dotfiles, and extensionless names are supported.
  - Editor tabs with dirty (unsaved-changes) indicators
  - Breadcrumbs, minimap, and a themed editor canvas
  - **Collapsible Terminal and People panels**: drag their headers to float and
    move them, resize floating panels from the bottom-right corner, or use the
    Dock button to return them to the workbench
  - Resize docked panels by dragging their divider; positions, sizes, and
    collapsed states are remembered in this browser
  - Toggle the terminal with **Ctrl/Cmd + `** or the toolbar; **Run file** opens
    the terminal automatically. Output and stdin survive moving/collapsing it.
  - Panel drag/resize handles also support arrow keys (**Shift** for larger
    steps); **Escape** cancels a drag. **Reset panel layout** restores defaults.
  - Status bar showing language, cursor position, and connection state
- **17 languages** supported for highlighting, with execution for the 14 that map
  to a Judge0 language ID (C, C++, C#, Go, Java, JavaScript, Kotlin, PHP, Python,
  Ruby, Rust, SQL, Swift, TypeScript); HTML and CSS render in a sandboxed preview
  iframe instead. Unrecognised extensions fall back to plain text rather than
  being sent to Judge0 as JavaScript.
- **Real-time collaboration**: edits are broadcast to everyone in the room via
  Socket.io, coalesced to one message per file per ~120 ms so a fast typist does
  not flood the room with intermediate states

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
- Nested folders in the explorer, with per-file dirty indicators
- **Server-authoritative file tree**: every file and folder lives in SQLite and
  is pushed to each client on join, so a file created by one person appears in
  everyone else's explorer. `localStorage` is only a local cache.

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
| Execution | Judge0 API (`JUDGE0_URL`, default `https://ce.judge0.com`) |

## Project structure

```
Code_Sync/
├── server.js              # Express + Socket.io server, room socket logic
├── server/
│   ├── db.js              # SQLite setup (users, rooms, room_files, room_folders)
│   ├── auth.js            # JWT helpers + auth middleware
│   └── data.sqlite        # local database (gitignored)
├── src/
│   ├── App.jsx            # Routes: /login, /, /editor/:roomId
│   ├── api.js             # Authenticated fetch wrapper for /api
│   ├── socket.js          # Socket.io client (sends JWT on connect)
│   ├── Actions.json       # Socket event names (JOIN, JOINED, CODE_CHANGE, ERROR, ...)
│   ├── fileTree.js        # Path normalisation + explorer tree builder
│   ├── preview.js         # Sandboxed HTML/CSS preview document builder
│   ├── languages.js       # Language list (Judge0 IDs + Monaco IDs)
│   ├── context/
│   │   └── AuthContext.jsx  # Auth state, login/register/logout
│   ├── components/
│   │   ├── ProtectedRoute.jsx # Redirects to /login when not signed in
│   │   ├── MonacoEditor.jsx   # Monaco wrapper with vs-dark theme
│   │   ├── CodeRunner.jsx     # Run button + output panel
│   │   └── Client.jsx         # Connected-user avatar
│   ├── pages/
│   │   ├── AuthPage.jsx   # Login / register screen
│   │   ├── Home.jsx       # Dashboard: create rooms, my rooms, join
│   │   └── EditorPage.jsx # VS Code-style workbench
│   ├── vscode.css         # Workbench styling
│   └── index.css          # Global styles
└── package.json
```

## Prerequisites

- **Node.js 22.13+** (Vite requires a recent Node release and the server uses the built-in `node:sqlite` module).
  Check yours with `node -v`. Download the latest LTS from [nodejs.org](https://nodejs.org).
- **npm** (comes with Node).
- Optional: a self-hosted [Judge0](https://github.com/judge0/judge0) instance.
  Without `JUDGE0_URL` the public CE endpoint is used, which is rate-limited and
  often slow. HTML and CSS files render in a sandboxed preview iframe and need no
  Judge0 at all.

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
# Point at a self-hosted Judge0, or leave unset for the public CE instance.
JUDGE0_URL=https://ce.judge0.com
# Comma-separated origins allowed to open a socket / call the API.
FRONTEND_URL=http://localhost:5173
# Upstream execution deadline, in ms.
EXECUTE_TIMEOUT_MS=20000
# Optional alternative SQLite file; tests use :memory: to keep real data untouched.
# DATABASE_PATH=/absolute/path/to/data.sqlite
```

> The server sends **no** auth header to Judge0 — it reads only `JUDGE0_URL`.
> If your Judge0 instance requires a key, add the header in the `/api/execute`
> handler in `server.js`.
>
> `JWT_SECRET` signs session tokens — keep it private and never commit `.env`.
> (`.gitignore` already excludes it, the SQLite database, and the server logs.)
> Startup fails if the secret is missing or still the placeholder.

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
| `npm run build` | Production build of the frontend into `build/` |
| `npm start` | Build, then serve the built app from the Express server |
| `npm run server:prod` | Serve the already-built app from Express |
| `npm test` | Run API, socket, file-tree, reconnect-state and preview regressions |
| `npm run test:browser` | Build and run Chromium user-workflow tests |

Before the first browser test run, install Chromium and its system dependencies:

```bash
npx playwright install --with-deps chromium
npm test
npm run test:browser
```

The browser suite starts a separate server on port **5100** with an in-memory
database. It covers authentication, private rooms, two-user collaboration,
offline/reconnect behavior, previews, execution errors, and phone-sized layouts.
Tests do not write to `server/data.sqlite`.

The static build is resolved relative to `server.js`, so `npm start` works from
any working directory.

## API reference (backend)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | — | Register (name, email, password ≥ 8 chars) |
| POST | `/api/auth/login` | — | Login (email, password) |
| GET | `/api/auth/me` | JWT | Current user profile |
| GET | `/api/rooms` | JWT | Rooms created by the user |
| POST | `/api/rooms` | JWT | Create room (name, optional password) |
| POST | `/api/execute` | JWT | Run code via Judge0 |

Unknown `/api/*` paths return a JSON `404` — they are never answered with the
SPA shell, so client-side `res.json()` calls fail with the real error instead of
`Request failed (200)`.

Socket.io connects to `http://localhost:5000` (proxied to `/socket.io` in dev)
with `auth: { token }`. Events: `join` `{ roomId, password }`, `joined`,
`join-denied`, `sync-files`, `code-change`, `file-created`, `file-deleted`,
`folder-created`, `folder-deleted`, `error`, `disconnected`.

A reconnect creates a **new** server-side socket, so the client re-joins the
room on every `connect` and replays any mutations queued while disconnected.

## Security notes

- Passwords are never stored in plain text (bcrypt, 12 rounds).
- JWTs expire after 7 days and are verified on every API call and socket connection.
- Room passwords are hashed; the server only ever compares hashes.
- Auth endpoints are rate-limited (20 per IP / 15 min). Room joins are throttled
  separately — 10 password attempts per IP + room per minute — because a socket
  handshake never touches the `/api/auth` limiter.
- A mutation the server refuses (file over 100,000 characters, deleting the last file, an
  over-long name) comes back as an `error` event with a message; nothing fails
  silently. The sender also receives the canonical room snapshot to reconcile
  optimistic explorer changes. Late edits cannot recreate deleted files.
- Folder deletes escape SQL `LIKE` metacharacters, so a folder named `a_b` does
  not delete the contents of `axb`.
- **The database is the source of truth for room contents.** `room_files` and
  `room_folders` hold every file and folder per room, and `localStorage` is only
  a per-browser cache of what you last saw.

## Known limitations

- Collaboration is **last-writer-wins full-text sync** (no CRDT/operational transforms),
  so simultaneous edits to the same line can overwrite each other.
- There is **no password reset** flow yet.
- Monaco and its workers are served with the app, and file-type badges are local;
  the editor no longer depends on third-party CDNs. Code execution still requires
  a reachable Judge0 service. HTML previews inline explicitly linked room CSS/JS
  files, resolving paths relative to the HTML file; package imports and bundling
  are not supported.

## License

MIT — feel free to fork and build on it.
