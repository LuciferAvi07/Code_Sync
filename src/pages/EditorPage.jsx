import React, { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import Client from '../components/Client';
import CodeRunner from '../components/CodeRunner';
import MovablePanel from '../components/MovablePanel';
import WorkbenchIcon from '../components/WorkbenchIcon';
import usePanelLayout from '../hooks/usePanelLayout';
import FileExplorer from '../components/FileExplorer';
import LanguageIcon from '../components/LanguageIcon';
import { getLanguageForFile } from '../languages';
import { isUnderFolder } from '../fileTree';
import { initSocket } from '../socket';
import { ACTIONS, replayRoomChanges } from '../roomState';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

const MonacoEditor = lazy(() => import('../components/MonacoEditor'));

// --- VS Code style icons ----------------------------------------------------
const FilesIcon = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
    </svg>
);

const SignOutIcon = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
);

// --- Page -------------------------------------------------------------------

// Typing produces a CODE_CHANGE per keystroke, and the old code persisted the
// whole room to localStorage on every one of them. Coalescing to one write per
// quiet period keeps remote viewers in sync while removing the write storm.
const BROADCAST_DEBOUNCE_MS = 120;
const STORAGE_DEBOUNCE_MS = 400;

const EditorPage = () => {
    const socketRef = useRef(null);
    const editorApiRef = useRef(null);
    const runnerRef = useRef(null);
    const workbenchRef = useRef(null);
    const joinRef = useRef(null);
    const gateOpenRef = useRef(false);
    const joinedRef = useRef(false);
    // Edits made before the socket exists must not be lost. Holds payloads until
    // the socket is connected *and* joined, at which point they are replayed in
    // order after the authoritative room snapshot arrives.
    const outboxRef = useRef([]);
    const location = useLocation();
    const { roomId } = useParams();
    const reactNavigator = useNavigate();
    const { user, logout } = useAuth();
    // Seeded from router state so a room opened straight from the dashboard
    // ("join with password") still authenticates on the very first connect,
    // and re-uses the same password when the socket reconnects.
    // Must be declared *after* `location` — reading it before initialisation
    // throws a TDZ ReferenceError during render, which unmounts the whole app.
    const joinPasswordRef = useRef(location.state?.password);

    const [clients, setClients] = useState([]);
    const [connectionState, setConnectionState] = useState('Connecting…');
    const [hasJoined, setHasJoined] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
    const [activePanel, setActivePanel] = useState('terminal');
    const [terminalLayout, setTerminalLayout, resetTerminal] = usePanelLayout('terminal', {
        floating: false, collapsed: false, x: 340, y: 380, width: 680, height: 300, dockSize: 270,
    });
    const [peopleLayout, setPeopleLayout, resetPeople] = usePanelLayout('people', {
        floating: false, collapsed: window.innerWidth <= 1100, x: 900, y: 120, width: 280, height: 350, dockSize: 248,
    });
    const [cursor, setCursor] = useState({ lineNumber: 1, column: 1 });
    const [needsPassword, setNeedsPassword] = useState(false);
    const [roomPasswordInput, setRoomPasswordInput] = useState('');
    const [gateError, setGateError] = useState('');

    const storageKey = `realtime-editor-${roomId}`;
    const [files, setFiles] = useState(() => {
        try {
            const savedRoom = JSON.parse(localStorage.getItem(storageKey));
            return savedRoom?.files?.length
                ? savedRoom.files.map((file) => ({
                      ...file,
                      savedContent: file.savedContent ?? file.content,
                  }))
                : [{ name: 'main.js', content: "console.log('Hello from main.js');", savedContent: "console.log('Hello from main.js');" }];
        } catch {
            return [{ name: 'main.js', content: "console.log('Hello from main.js');", savedContent: "console.log('Hello from main.js');" }];
        }
    });
    const [activeFileName, setActiveFileName] = useState(() => {
        try {
            const savedRoom = JSON.parse(localStorage.getItem(storageKey));
            return savedRoom?.activeFileName || 'main.js';
        } catch {
            return 'main.js';
        }
    });
    const [openFileNames, setOpenFileNames] = useState(() => {
        try {
            const savedRoom = JSON.parse(localStorage.getItem(storageKey));
            return savedRoom?.openFileNames?.length
                ? savedRoom.openFileNames
                : [savedRoom?.activeFileName || 'main.js'];
        } catch {
            return ['main.js'];
        }
    });
    const [folders, setFolders] = useState(() => {
        try {
            const savedRoom = JSON.parse(localStorage.getItem(storageKey));
            return Array.isArray(savedRoom?.folders) ? savedRoom.folders : [];
        } catch {
            return [];
        }
    });
    const [sidebarWidth, setSidebarWidth] = useState(240);
    const resizingRef = useRef(null);

    const activeFile = files.find((file) => file.name === activeFileName) || files[0];
    const language = getLanguageForFile(activeFile.name);
    const breadcrumbs = activeFile.name.split('/');

    const toggleTerminal = useCallback(() => {
        setActivePanel('terminal');
        setTerminalLayout((current) => ({ ...current, collapsed: !current.collapsed }));
    }, [setTerminalLayout]);
    const togglePeople = () => {
        setActivePanel('people');
        setPeopleLayout((current) => ({ ...current, collapsed: !current.collapsed }));
    };
    const resetLayout = () => {
        resetTerminal();
        resetPeople();
        setSidebarWidth(240);
        setSidebarOpen(window.innerWidth > 820);
        if (window.innerWidth <= 1100) setPeopleLayout((current) => ({ ...current, collapsed: true }));
        toast.success('Workspace layout reset');
    };
    const runActiveFile = () => {
        setTerminalLayout((current) => ({ ...current, collapsed: false }));
        setActivePanel('terminal');
        runnerRef.current?.run();
    };

    useEffect(() => {
        const shortcut = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.code === 'Backquote') {
                event.preventDefault();
                toggleTerminal();
            }
        };
        const smallScreen = window.matchMedia('(max-width: 1100px)');
        const collapsePeople = () => {
            if (smallScreen.matches) setPeopleLayout((current) => ({ ...current, collapsed: true }));
        };
        collapsePeople();
        smallScreen.addEventListener('change', collapsePeople);
        window.addEventListener('keydown', shortcut);
        return () => {
            smallScreen.removeEventListener('change', collapsePeople);
            window.removeEventListener('keydown', shortcut);
        };
    }, [setPeopleLayout, toggleTerminal]);

    // Mirror of the active file path for use inside socket callbacks, which
    // are registered once and would otherwise see a stale closure value.
    const activeFileNameRef = useRef(activeFileName);
    useEffect(() => {
        activeFileNameRef.current = activeFileName;
    }, [activeFileName]);

    // --- Outgoing message queue ---------------------------------------------
    // `socketRef.current?.emit(...)` silently no-ops while the socket is still
    // connecting, so anything typed or created during that window updated local
    // state only and was then wiped by the SYNC_FILES that follows on join.
    const emit = useCallback((event, payload) => {
        const socket = socketRef.current;
        if (socket?.connected && joinedRef.current) {
            socket.emit(event, payload);
            return;
        }
        // Structural mutations must survive in order and be replayed verbatim.
        outboxRef.current.push([event, payload]);
    }, []);

    // Coalesce CODE_CHANGE per path: only the newest text for a file matters,
    // and it keeps a fast typist from flooding the room with intermediate states.
    const pendingCodeRef = useRef(new Map());
    const codeTimerRef = useRef(null);

    const flushCodeChanges = useCallback(() => {
        codeTimerRef.current = null;
        const pending = pendingCodeRef.current;
        pendingCodeRef.current = new Map();
        for (const [path, code] of pending) {
            emit(ACTIONS.CODE_CHANGE, { roomId, path, code });
        }
    }, [emit, roomId]);

    const queueCodeChange = useCallback(
        (path, code) => {
            pendingCodeRef.current.set(path, code);
            if (!codeTimerRef.current) {
                codeTimerRef.current = setTimeout(flushCodeChanges, BROADCAST_DEBOUNCE_MS);
            }
        },
        [flushCodeChanges]
    );

    const discardPendingChanges = (path, subtree = false) => {
        const matches = (candidate) => candidate === path || (subtree && isUnderFolder(candidate, path));
        for (const name of pendingCodeRef.current.keys()) {
            if (matches(name)) pendingCodeRef.current.delete(name);
        }
        outboxRef.current = outboxRef.current.filter(([event, payload]) =>
            event !== ACTIONS.CODE_CHANGE || !matches(payload.path)
        );
    };

    useEffect(() => {
        const flush = () => {
            if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
            flushCodeChanges();
        };
        window.addEventListener('pagehide', flush);
        return () => window.removeEventListener('pagehide', flush);
    }, [flushCodeChanges]);

    // Never leave a pending edit in the debounce window on unmount.
    useEffect(
        () => () => {
            if (codeTimerRef.current) {
                clearTimeout(codeTimerRef.current);
                flushCodeChanges();
            }
        },
        [flushCodeChanges]
    );

    // If the active file disappears (deleted by us or by another user),
    // fall back to another open file so the editor never points at nothing.
    useEffect(() => {
        const liveNames = new Set(files.map((file) => file.name));
        // Tabs for files that no longer exist render as blanks otherwise.
        const keptTabs = openFileNames.filter((name) => liveNames.has(name));
        if (keptTabs.length !== openFileNames.length) {
            setOpenFileNames(keptTabs);
        }
        if (!liveNames.size) return;
        if (liveNames.has(activeFileName)) {
            if (!keptTabs.includes(activeFileName)) {
                setOpenFileNames((current) =>
                    current.includes(activeFileName) ? current : [...current, activeFileName]
                );
            }
            return;
        }
        const fallback =
            keptTabs.find((name) => liveNames.has(name)) || files[0].name;
        setActiveFileName(fallback);
        setOpenFileNames((current) => (current.includes(fallback) ? current : [...current, fallback]));
    }, [files, activeFileName, openFileNames]);

    // Persist a debounced, best-effort cache; the server remains authoritative.
    useEffect(() => {
        const timer = setTimeout(() => {
            try {
                localStorage.setItem(
                    storageKey,
                    JSON.stringify({ files, folders, activeFileName, openFileNames })
                );
            } catch {
                // Storage is a best-effort cache; quota failures must not crash editing.
            }
        }, STORAGE_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [activeFileName, files, folders, openFileNames, storageKey]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
                flushCodeChanges();
                setFiles((currentFiles) =>
                    currentFiles.map((file) =>
                        file.name === activeFile.name
                            ? { ...file, savedContent: file.content }
                            : file
                    )
                );
                if (joinedRef.current) toast.success(`${activeFile.name} saved`);
                else toast('Changes queued until the room reconnects.');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeFile.name, flushCodeChanges]);

    useEffect(() => {
        const resize = (event) => {
            if (resizingRef.current) {
                const { startX, startWidth } = resizingRef.current;
                setSidebarWidth(Math.min(480, Math.max(200, startWidth + event.clientX - startX)));
            }
        };
        const stopResize = () => {
            resizingRef.current = null;
            document.body.classList.remove('isResizing');
        };
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', stopResize);
        return () => {
            document.removeEventListener('mousemove', resize);
            document.removeEventListener('mouseup', stopResize);
            document.body.classList.remove('isResizing');
        };
    }, []);

    // Local keystroke: update our own state and broadcast the change tagged
    // with the file path, so receivers apply it to the right file.
    function handleLocalCodeChange(code) {
        if (!hasJoined) return;
        if (code.length > 100_000) {
            toast.error('Files must be at most 100,000 characters.', { id: 'file-size' });
            editorApiRef.current?.applyRemoteCode(activeFile.content);
            return;
        }
        const path = activeFileNameRef.current;
        setFiles((currentFiles) =>
            currentFiles.map((file) =>
                file.name === path ? { ...file, content: code } : file
            )
        );
        queueCodeChange(path, code);
    }

    function openFile(name) {
        activeFileNameRef.current = name;
        setActiveFileName(name);
        setOpenFileNames((currentNames) =>
            currentNames.includes(name) ? currentNames : [...currentNames, name]
        );
        if (window.innerWidth <= 820) setSidebarOpen(false);
    }

    function closeTab(name) {
        const remainingNames = openFileNames.filter((fileName) => fileName !== name);
        if (!remainingNames.length) return;
        setOpenFileNames(remainingNames);
        if (name === activeFile.name) {
            setActiveFileName(remainingNames[remainingNames.length - 1]);
        }
    }

    function createEntry({ kind, path, folders: neededFolders }) {
        setFolders((currentFolders) => [
            ...currentFolders,
            ...neededFolders.filter((folder) => !currentFolders.includes(folder)),
        ]);
        if (kind === 'folder') {
            emit(ACTIONS.FOLDER_CREATED, { roomId, path, kind });
        } else {
            setFiles((currentFiles) => [...currentFiles, { name: path, content: '', savedContent: '' }]);
            emit(ACTIONS.FILE_CREATED, { roomId, path, content: '', kind });
            openFile(path);
        }
    }

    function deleteFolder(folderPath) {
        const insideFiles = files.filter((file) => isUnderFolder(file.name, folderPath));
        const message = insideFiles.length
            ? `Delete folder "${folderPath}" and ${insideFiles.length} file(s) inside it?`
            : `Delete folder "${folderPath}"?`;
        if (!window.confirm(message)) return;
        if (insideFiles.length === files.length) {
            toast.error('A room must have at least one file.');
            return;
        }

        const remainingFiles = files.filter((file) => !isUnderFolder(file.name, folderPath));
        const remainingFolders = folders.filter(
            (folder) => folder !== folderPath && !isUnderFolder(folder, folderPath)
        );
        const remainingOpenFiles = openFileNames.filter((name) => !isUnderFolder(name, folderPath));
        setFiles(remainingFiles);
        setFolders(remainingFolders);
        setOpenFileNames(remainingOpenFiles.length ? remainingOpenFiles : [remainingFiles[0].name]);
        if (isUnderFolder(activeFile.name, folderPath)) {
            setActiveFileName(remainingFiles[0].name);
        }
        discardPendingChanges(folderPath, true);
        emit(ACTIONS.FOLDER_DELETED, { roomId, path: folderPath, kind: 'folder' });
        toast.success(`Folder "${folderPath}" deleted.`);
    }

    function deleteFile(fileName) {
        if (files.length === 1) {
            toast.error('A room must have at least one file.');
            return;
        }
        const remainingFiles = files.filter((file) => file.name !== fileName);
        // closeTab() intentionally refuses to close the final tab, which used to
        // leave the deleted file's name in openFileNames and render an empty tab
        // bar. Prune the dead name directly instead.
        setOpenFileNames((current) => {
            const remaining = current.filter((name) => name !== fileName);
            return remaining.length ? remaining : [remainingFiles[0].name];
        });
        setFiles(remainingFiles);
        if (fileName === activeFile.name) {
            setActiveFileName(remainingFiles[0].name);
        }
        discardPendingChanges(fileName);
        emit(ACTIONS.FILE_DELETED, { roomId, path: fileName, kind: 'file' });
    }

    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            const socket = initSocket();
            if (cancelled) {
                socket.disconnect();
                return;
            }
            socketRef.current = socket;

            let lastErrorToastAt = 0;
            const handleConnectError = (err) => {
                // Only an auth rejection is fatal. Every other connect_error is
                // usually a transient blip and socket.io retries on its own, so
                // reacting to each one spammed toasts and could navigate away
                // mid-edit.
                if (err?.message === 'unauthorized' || err?.data === 'unauthorized') {
                    toast.error('Your session expired. Please sign in again.');
                    logout();
                    reactNavigator('/login');
                    return;
                }
                const now = Date.now();
                if (now - lastErrorToastAt < 10_000) return;
                lastErrorToastAt = now;
                console.log('socket error', err?.message || err);
                toast.error('Connection problem — retrying…');
            };
            socket.on('connect_error', handleConnectError);

            // The server refuses some mutations (file too large, last-file guard,
            // wrong room). Previously it returned silently, so the local editor
            // showed a save that never reached the room.
            socket.on(ACTIONS.ERROR, ({ message } = {}) => {
                if (message) toast.error(message);
            });

            const doJoin = (password) => {
                joinPasswordRef.current = password;
                socket.emit(ACTIONS.JOIN, { roomId, password });
            };
            joinRef.current = doJoin;

            // A reconnect lands on a brand-new server-side socket that has not
            // joined the room, so the join has to be re-sent; otherwise every
            // later edit failed the `socket.rooms.has(roomId)` guard and
            // silently vanished. JOIN itself is buffered by socket.io, so
            // emitting here covers both the first connect and every reconnect.
            socket.on('connect', () => {
                joinedRef.current = false;
                setConnectionState('Joining…');
                socket.emit(ACTIONS.JOIN, {
                    roomId,
                    password: joinPasswordRef.current,
                });
            });
            socket.on('disconnect', () => {
                joinedRef.current = false;
                setClients([]);
                setConnectionState('Offline — edits queued');
            });

            socket.on(ACTIONS.JOIN_DENIED, ({ reason } = {}) => {
                joinedRef.current = false;
                setConnectionState('Not joined');
                if (reason === 'wrong-password') {
                    const wasOpen = gateOpenRef.current;
                    gateOpenRef.current = true;
                    setNeedsPassword(true);
                    if (wasOpen) setGateError('Incorrect password, try again.');
                } else if (reason === 'throttled') {
                    toast.error('Too many join attempts. Wait a minute and reload.');
                } else {
                    toast.error('Room not found. Ask the host for a new invite.');
                    reactNavigator('/');
                }
            });

            socket.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
                if (socketId !== socket.id) {
                    toast.success(`${username} joined the room.`);
                }
                setClients(clients);
                gateOpenRef.current = false;
                setNeedsPassword(false);
                setGateError('');
                // The server sends this socket a SYNC_FILES event right after
                // joining, so no client-to-client code sync is needed.
                // NOTE: the outbox is flushed by the SYNC_FILES handler below,
                // not here — flushing here would race that event and be
                // overwritten by the authoritative snapshot.
            });

            socket.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
                toast.success(`${username} left the room.`);
                setClients((prev) => prev.filter((client) => client.socketId !== socketId));
            });

            // Canonical file/folder state for the room, sent by the server on
            // every join. This is what makes one user's files appear in the
            // other user's explorer. It replaces the browser-local copy.
            socket.on(ACTIONS.SYNC_FILES, ({ files: serverFiles, folders: serverFolders } = {}) => {
                if (Array.isArray(serverFiles) && serverFiles.length) {
                    if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
                    codeTimerRef.current = null;
                    for (const [path, code] of pendingCodeRef.current) {
                        outboxRef.current.push([ACTIONS.CODE_CHANGE, { roomId, path, code }]);
                    }
                    pendingCodeRef.current.clear();
                    const queued = outboxRef.current;
                    outboxRef.current = [];
                    const state = replayRoomChanges({ files: serverFiles, folders: serverFolders }, queued);
                    const mapped = state.files;
                    const names = new Set(mapped.map((file) => file.name));
                    setFiles(mapped);
                    setFolders(state.folders);
                    setOpenFileNames((current) => {
                        const kept = current.filter((name) => names.has(name));
                        return kept.length ? kept : [mapped[0].name];
                    });
                    setActiveFileName((current) =>
                        names.has(current) ? current : mapped[0].name
                    );
                    joinedRef.current = true;
                    setHasJoined(true);
                    setConnectionState('Connected');
                    for (const [event, payload] of queued) socket.emit(event, payload);
                }
            });

            // A remote edit: update the matching file in state, and only push
            // it into the open editor when it is the file being edited.
            // Edits to other files just refresh their cached content.
            socket.on(ACTIONS.CODE_CHANGE, ({ path, code }) => {
                if (typeof path !== 'string' || typeof code !== 'string') return;
                setFiles((currentFiles) =>
                    currentFiles.map((file) =>
                        file.name === path ? { ...file, content: code } : file
                    )
                );
                if (path === activeFileNameRef.current) {
                    editorApiRef.current?.applyRemoteCode(code);
                }
            });

            socket.on(ACTIONS.FILE_CREATED, ({ path, content, folders: serverFolders, username }) => {
                if (typeof path !== 'string') return;
                setFiles((currentFiles) => {
                    if (currentFiles.some((file) => file.name === path)) return currentFiles;
                    return [
                        ...currentFiles,
                        { name: path, content: content ?? '', savedContent: content ?? '' },
                    ];
                });
                if (Array.isArray(serverFolders)) setFolders(serverFolders);
                if (username && username !== user.name) {
                    toast.success(`${username} created ${path.split('/').pop()}`);
                }
            });

            socket.on(ACTIONS.FILE_DELETED, ({ path, username }) => {
                if (typeof path !== 'string') return;
                discardPendingChanges(path);
                setFiles((currentFiles) => {
                    if (currentFiles.length <= 1) return currentFiles;
                    return currentFiles.filter((file) => file.name !== path);
                });
                setOpenFileNames((current) => {
                    const kept = current.filter((name) => name !== path);
                    return kept.length ? kept : current;
                });
                if (username && username !== user.name) {
                    toast(`${username} deleted ${path.split('/').pop()}`);
                }
            });

            socket.on(ACTIONS.FOLDER_CREATED, ({ folders: serverFolders, username, path }) => {
                if (Array.isArray(serverFolders)) setFolders(serverFolders);
                if (username && username !== user.name && typeof path === 'string') {
                    toast.success(`${username} created folder ${path}`);
                }
            });

            socket.on(ACTIONS.FOLDER_DELETED, ({ path, username }) => {
                if (typeof path !== 'string') return;
                discardPendingChanges(path, true);
                setFolders((currentFolders) =>
                    currentFolders.filter(
                        (folder) => folder !== path && !isUnderFolder(folder, path)
                    )
                );
                setFiles((currentFiles) => {
                    const remaining = currentFiles.filter(
                        (file) => file.name !== path && !isUnderFolder(file.name, path)
                    );
                    return remaining.length ? remaining : currentFiles;
                });
                setOpenFileNames((current) => {
                    const kept = current.filter(
                        (name) => name !== path && !isUnderFolder(name, path)
                    );
                    return kept.length ? kept : current;
                });
                if (username && username !== user.name) {
                    toast(`${username} deleted folder ${path}`);
                }
            });
        };
        init();
        return () => {
            cancelled = true;
            if (codeTimerRef.current) clearTimeout(codeTimerRef.current);
            const socket = socketRef.current;
            if (socket) {
                socket.off(ACTIONS.JOINED);
                socket.off(ACTIONS.DISCONNECTED);
                socket.off(ACTIONS.CODE_CHANGE);
                socket.off(ACTIONS.SYNC_FILES);
                socket.off(ACTIONS.FILE_CREATED);
                socket.off(ACTIONS.FILE_DELETED);
                socket.off(ACTIONS.FOLDER_CREATED);
                socket.off(ACTIONS.FOLDER_DELETED);
                socket.off(ACTIONS.JOIN_DENIED);
                socket.off(ACTIONS.ERROR);
                socket.off('connect');
                socket.off('connect_error');
                socket.off('disconnect');
                socket.disconnect();
                socketRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function copyRoomId() {
        try {
            await navigator.clipboard.writeText(roomId);
            toast.success('Room ID has been copied to your clipboard');
        } catch (err) {
            toast.error('Could not copy the Room ID');
            console.error(err);
        }
    }

    function handleLogout() {
        logout();
        reactNavigator('/login');
    }

    function submitRoomPassword(e) {
        e.preventDefault();
        if (!roomPasswordInput) return;
        setGateError('');
        joinRef.current?.(roomPasswordInput);
    }

    return (
        <div className="vscode">
            {/* Title bar */}
            <header className="vs-titlebar">
                <div className="vs-titlebar-left">
                    <button className="vs-mobile-explorer" aria-label="Toggle explorer" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
                        <FilesIcon size={20} />
                    </button>
                    <span className="vs-brand-mark"><WorkbenchIcon name="code" size={18} /></span>
                    <span className="vs-brand-name">Code<span>Sync</span></span>
                    <span className="vs-workspace-label">WORKSPACE</span>
                </div>
                <div className="vs-titlebar-center">
                    <button className="vs-room-chip" onClick={copyRoomId} title="Click to copy room ID">
                        <WorkbenchIcon name="link" size={14} />
                        <span>Room / {roomId.slice(0, 8)}</span>
                        <span className="vs-room-chip-hint">Copy invite</span>
                    </button>
                </div>
                <div className="vs-titlebar-right">
                    <span className={`vs-live-indicator${connectionState === 'Connected' ? ' is-live' : ''}`}>
                        <span />{connectionState === 'Connected' ? 'Live session' : 'Connecting'}
                    </span>
                    <button className="vscode-btn-ghost" onClick={() => reactNavigator('/')}>Rooms</button>
                    <span className="vs-avatar">{user.name.charAt(0).toUpperCase()}</span>
                    <span className="vs-username">{user.name}</span>
                </div>
            </header>

            <div className="vs-workbench" ref={workbenchRef}>
                {/* Activity bar */}
                <nav className="vs-activitybar" aria-label="Activity bar">
                    <button className={`vs-activity-btn${sidebarOpen ? ' active' : ''}`} title="Explorer" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>
                        <FilesIcon />
                    </button>
                    <button className={`vs-activity-btn${!terminalLayout.collapsed ? ' active' : ''}`} title="Terminal (Ctrl+`)" aria-label="Toggle terminal from activity bar" aria-expanded={!terminalLayout.collapsed} onClick={toggleTerminal}>
                        <WorkbenchIcon name="terminal" size={22} />
                    </button>
                    <button className={`vs-activity-btn${!peopleLayout.collapsed ? ' active' : ''}`} title="People" aria-label="Toggle people from activity bar" aria-expanded={!peopleLayout.collapsed} onClick={togglePeople}>
                        <WorkbenchIcon name="people" size={22} />
                    </button>
                    <div className="vs-activity-spacer" />
                    <button className="vs-activity-btn" title="Reset workspace layout" aria-label="Reset workspace layout" onClick={resetLayout}>
                        <WorkbenchIcon name="reset" size={20} />
                    </button>
                    <button className="vs-activity-btn" title="Sign out" onClick={handleLogout}>
                        <SignOutIcon />
                    </button>
                </nav>

                {/* Side bar */}
                <aside className={`vs-sidebar${sidebarOpen ? '' : ' is-hidden'}`} style={{ width: sidebarWidth }} inert={!hasJoined ? '' : undefined}>
                    <FileExplorer
                        files={files} folders={folders} activeFileName={activeFile.name}
                        onOpenFile={openFile} onCreateEntry={createEntry}
                        onDeleteFile={deleteFile} onDeleteFolder={deleteFolder}
                    />
                </aside>
                <div
                    className={`vs-sash${sidebarOpen ? '' : ' is-hidden'}`}
                    role="separator"
                    aria-label="Resize sidebar"
                    onMouseDown={(event) => {
                        resizingRef.current = { startX: event.clientX, startWidth: sidebarWidth };
                        document.body.classList.add('isResizing');
                    }}
                />

                {/* Main column */}
                <div className="vs-main">
                    <div className="vs-editor-topline">
                    <nav className="vs-tabs" aria-label="Open files">
                        {openFileNames.map((fileName) => {
                            const file = files.find((item) => item.name === fileName);
                            if (!file) return null;
                            const dirty = file.content !== file.savedContent;
                            return (
                                <div
                                    className={`vs-tab${fileName === activeFile.name ? ' active' : ''}`}
                                    key={fileName}
                                >
                                    <button
                                        className="vs-tab-label"
                                        onClick={() => setActiveFileName(fileName)}
                                        title={fileName}
                                    >
                                        <LanguageIcon fileName={fileName} />
                                        <span>{fileName.split('/').pop()}</span>
                                        {dirty ? (
                                            <span className="vs-dirty-dot" title="Unsaved changes" />
                                        ) : (
                                            <span className="vs-tab-x-space" />
                                        )}
                                    </button>
                                    {openFileNames.length > 1 && (
                                        <button
                                            className="vs-tab-close"
                                            onClick={() => closeTab(fileName)}
                                            aria-label={`Close ${fileName}`}
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </nav>
                    <div className="vs-editor-actions">
                        <button className="vs-icon-button vs-run-file" aria-label="Run file" title="Run current file" disabled={!hasJoined || needsPassword} onClick={runActiveFile}><WorkbenchIcon name="play" size={14} /></button>
                    </div>
                    </div>

                    <div className="vs-breadcrumbs" aria-label="Breadcrumb">
                        {breadcrumbs.map((segment, i) => (
                            <React.Fragment key={i}>
                                {i > 0 && <span className="vs-crumb-sep">›</span>}
                                <span className={i === breadcrumbs.length - 1 ? 'vs-crumb current' : 'vs-crumb'}>
                                    {segment}
                                </span>
                            </React.Fragment>
                        ))}
                    </div>

                    <div className="vs-editor">
                        {needsPassword ? (
                            <div className="vs-gate">
                                <form className="vs-gate-card" onSubmit={submitRoomPassword}>
                                    <h2>🔒 Password protected room</h2>
                                    <p>Enter the room password to join the session.</p>
                                    <input
                                        type="password"
                                        autoFocus
                                        value={roomPasswordInput}
                                        onChange={(e) => setRoomPasswordInput(e.target.value)}
                                        placeholder="Room password"
                                        aria-label="Room password"
                                    />
                                    {gateError && <div className="vs-gate-error">{gateError}</div>}
                                    <div className="vs-gate-actions">
                                        <button
                                            type="button"
                                            className="vscode-btn-ghost"
                                            onClick={() => reactNavigator('/')}
                                        >
                                            Back
                                        </button>
                                        <button type="submit" className="vscode-btn-primary">
                                            Join room
                                        </button>
                                    </div>
                                </form>
                            </div>
                        ) : !hasJoined ? (
                            <div className="monaco-loading" role="status">{connectionState}</div>
                        ) : (
                            <Suspense fallback={<div className="monaco-loading">Loading editor…</div>}>
                            <MonacoEditor
                                key={activeFile.name}
                                fileName={activeFile.name}
                                initialCode={activeFile.content}
                                language={language}
                                onCodeChange={handleLocalCodeChange}
                                onCursorChange={setCursor}
                                editorApiRef={editorApiRef}
                            />
                            </Suspense>
                        )}
                    </div>

                    <MovablePanel
                        id="terminal" title="Terminal" icon="terminal" dock="bottom"
                        layout={terminalLayout} onLayoutChange={setTerminalLayout}
                        boundsRef={workbenchRef} active={activePanel === 'terminal'}
                        onActivate={() => setActivePanel('terminal')}
                    >
                        <CodeRunner
                            ref={runnerRef}
                            key={activeFile.name}
                            disabled={!hasJoined || needsPassword}
                            code={activeFile.content}
                            fileName={activeFile.name}
                            files={files}
                            language={language}
                        />
                    </MovablePanel>
                </div>
                <MovablePanel
                    id="people" title="People" icon="people" badge={clients.length} dock="right"
                    layout={peopleLayout} onLayoutChange={setPeopleLayout}
                    boundsRef={workbenchRef} active={activePanel === 'people'}
                    onActivate={() => setActivePanel('people')}
                >
                    <div className="vs-people-summary">
                        <span className={`vs-presence-dot${connectionState === 'Connected' ? ' is-online' : ''}`} />
                        <span>{connectionState === 'Connected' ? `${clients.length} ${clients.length === 1 ? 'person' : 'people'} in this room` : connectionState}</span>
                    </div>
                    <div className="vs-clients">
                        {clients.map((client) => (
                            <Client key={client.socketId} username={client.username} isSelf={client.socketId === socketRef.current?.id} />
                        ))}
                        {!clients.length && <p className="vs-people-empty">Your collaborators will appear here once connected.</p>}
                    </div>
                    <div className="vs-people-invite">
                        <WorkbenchIcon name="link" size={20} />
                        <strong>Better together.</strong>
                        <p>Share your room and build something great, together.</p>
                        <button className="vscode-btn-ghost" onClick={copyRoomId}><WorkbenchIcon name="link" size={13} /> Copy invite ID</button>
                    </div>
                </MovablePanel>
            </div>

            {/* Status bar */}
            <footer className="vs-statusbar">
                <div className="vs-status-left">
                    <button className="vs-status-item" onClick={copyRoomId} title="Copy room ID">
                        <WorkbenchIcon name="link" size={12} />&nbsp;{roomId.slice(0, 8)}
                    </button>
                    <span className="vs-status-item" role="status"><span className={`vs-presence-dot${connectionState === 'Connected' ? ' is-online' : ''}`} />{connectionState === 'Connected' ? `${clients.length} connected` : connectionState}</span>
                </div>
                <div className="vs-status-right">
                    <span className="vs-status-item">
                        Ln {cursor.lineNumber}, Col {cursor.column}
                    </span>
                    <span className="vs-status-item">Spaces: 2</span>
                    <span className="vs-status-item">UTF-8</span>
                    <span className="vs-status-item">{language.label}</span>
                </div>
            </footer>
        </div>
    );
};

export default EditorPage;
