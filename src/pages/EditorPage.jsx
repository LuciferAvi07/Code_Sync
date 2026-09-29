import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions.json';
import Client from '../components/Client';
import MonacoEditor from '../components/MonacoEditor';
import CodeRunner from '../components/CodeRunner';
import { getLanguageForFile } from '../languages';
import {
    normalizePath,
    splitPath,
    hasTraversalSegments,
    ancestorPaths,
    isUnderFolder,
    buildFileTree,
} from '../fileTree';
import { initSocket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

// --- VS Code style icons ----------------------------------------------------
const FilesIcon = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
    </svg>
);

const NewFileIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M12 18v-6M9 15h6" />
    </svg>
);

const NewFolderIcon = ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
        <path d="M12 11v6M9 14h6" />
    </svg>
);

const FolderIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
);

const SignOutIcon = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
);

const ChevronIcon = ({ open }) => (
    <svg className={`vs-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="m9 6 6 6-6 6" />
    </svg>
);

const LanguageIcon = ({ fileName }) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const languageAssets = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', java: 'java', cpp: 'cplusplus', cc: 'cplusplus',
        cxx: 'cplusplus', c: 'c', h: 'c', cs: 'csharp', go: 'go', rs: 'rust',
        rb: 'ruby', php: 'php', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
        html: 'html5', css: 'css3',
        sql: 'database',
    };
    const assetName = languageAssets[extension];
    return (
        <span className="vs-lang-icon" title={getLanguageForFile(fileName).label}>
            {assetName ? (
                <img src={`https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${assetName}/${assetName}-original.svg`} alt="" aria-hidden="true" />
            ) : (
                <span className="vs-lang-fallback">≡</span>
            )}
        </span>
    );
};

// --- Page -------------------------------------------------------------------
const EditorPage = () => {
    const socketRef = useRef(null);
    const editorApiRef = useRef(null);
    const joinRef = useRef(null);
    const gateOpenRef = useRef(false);
    const codeRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const reactNavigator = useNavigate();
    const { user, logout } = useAuth();

    const [clients, setClients] = useState([]);
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
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    const [fileError, setFileError] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderError, setFolderError] = useState('');
    const [collapsedFolders, setCollapsedFolders] = useState({});
    const [folders, setFolders] = useState(() => {
        try {
            const savedRoom = JSON.parse(localStorage.getItem(storageKey));
            return Array.isArray(savedRoom?.folders) ? savedRoom.folders : [];
        } catch {
            return [];
        }
    });
    const [sidebarWidth, setSidebarWidth] = useState(260);
    const resizingRef = useRef(null);

    const activeFile = files.find((file) => file.name === activeFileName) || files[0];
    const language = getLanguageForFile(activeFile.name);
    const breadcrumbs = activeFile.name.split('/');

    useEffect(() => {
        localStorage.setItem(
            storageKey,
            JSON.stringify({ files, folders, activeFileName, openFileNames })
        );
    }, [activeFileName, files, folders, openFileNames, storageKey]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                setFiles((currentFiles) =>
                    currentFiles.map((file) =>
                        file.name === activeFile.name
                            ? { ...file, savedContent: file.content }
                            : file
                    )
                );
                toast.success(`${activeFile.name} saved`);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeFile.name]);

    useEffect(() => {
        const resize = (event) => {
            if (resizingRef.current === 'sidebar') {
                setSidebarWidth(Math.min(480, Math.max(200, event.clientX - 48)));
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
        };
    }, []);

    function handleLocalCodeChange(code) {
        codeRef.current = code;
        setFiles((currentFiles) =>
            currentFiles.map((file) =>
                file.name === activeFile.name ? { ...file, content: code } : file
            )
        );
        socketRef.current?.emit(ACTIONS.CODE_CHANGE, { roomId, code });
    }

    function openFile(name) {
        setActiveFileName(name);
        setOpenFileNames((currentNames) =>
            currentNames.includes(name) ? currentNames : [...currentNames, name]
        );
    }

    function closeTab(name) {
        const remainingNames = openFileNames.filter((fileName) => fileName !== name);
        if (!remainingNames.length) return;
        setOpenFileNames(remainingNames);
        if (name === activeFile.name) {
            setActiveFileName(remainingNames[remainingNames.length - 1]);
        }
    }

    function createFile() {
        const name = normalizePath(newFileName);
        if (!name) return;
        const segments = splitPath(name);
        if (hasTraversalSegments(segments)) {
            setFileError('Folder names "." and ".." are not allowed');
            return;
        }
        const baseName = segments[segments.length - 1];
        if (!baseName || !baseName.includes('.')) {
            setFileError('File should have the extension');
            return;
        }
        if (files.some((file) => file.name === name)) {
            setFileError('A file with this name already exists');
            return;
        }
        if (folders.includes(name)) {
            setFileError('A folder with this name already exists');
            return;
        }
        const neededFolders = ancestorPaths(segments);
        const conflicting = neededFolders.find((folder) =>
            files.some((file) => file.name === folder)
        );
        if (conflicting) {
            setFileError(`A file named "${conflicting}" already exists`);
            return;
        }

        const newFile = { name, content: '', savedContent: '' };
        setFiles((currentFiles) => [...currentFiles, newFile]);
        setFolders((currentFolders) => [
            ...currentFolders,
            ...neededFolders.filter((folder) => !currentFolders.includes(folder)),
        ]);
        openFile(newFile.name);
        setNewFileName('');
        setFileError('');
        setIsCreatingFile(false);
    }

    function createFolder() {
        const path = normalizePath(newFolderName);
        if (!path) return;
        const segments = splitPath(path);
        if (hasTraversalSegments(segments)) {
            setFolderError('Folder names "." and ".." are not allowed');
            return;
        }
        if (folders.includes(path)) {
            setFolderError('A folder with this name already exists');
            return;
        }
        if (files.some((file) => file.name === path)) {
            setFolderError('A file with this name already exists');
            return;
        }
        const neededFolders = ancestorPaths(segments, true);
        const conflicting = neededFolders.find((folder) =>
            files.some((file) => file.name === folder)
        );
        if (conflicting) {
            setFolderError(`A file named "${conflicting}" already exists`);
            return;
        }
        setFolders((currentFolders) => [
            ...currentFolders,
            ...neededFolders.filter((folder) => !currentFolders.includes(folder)),
        ]);
        setNewFolderName('');
        setFolderError('');
        setIsCreatingFolder(false);
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
        toast.success(`Folder "${folderPath}" deleted.`);
    }

    function toggleFolder(folderPath) {
        setCollapsedFolders((current) => ({
            ...current,
            [folderPath]: !current[folderPath],
        }));
    }

    function addFileToFolder(folderPath) {
        setIsCreatingFolder(false);
        setFileError('');
        setNewFileName(`${folderPath}/`);
        setIsCreatingFile(true);
    }

    function deleteFile(fileName) {
        if (files.length === 1) {
            toast.error('A room must have at least one file.');
            return;
        }
        const remainingFiles = files.filter((file) => file.name !== fileName);
        setFiles(remainingFiles);
        closeTab(fileName);
        if (fileName === activeFile.name) {
            setActiveFileName(remainingFiles[0].name);
        }
    }

    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            const socket = await initSocket();
            if (cancelled) {
                socket.disconnect();
                return;
            }
            socketRef.current = socket;

            const handleErrors = (err) => {
                if (err && err.message === 'unauthorized') {
                    toast.error('Your session expired. Please sign in again.');
                    logout();
                    reactNavigator('/login');
                    return;
                }
                console.log('socket error', err);
                toast.error('Socket connection failed, try again later.');
                reactNavigator('/');
            };
            socket.on('connect_error', handleErrors);
            socket.on('connect_failed', handleErrors);

            const doJoin = (password) => {
                socket.emit(ACTIONS.JOIN, { roomId, password });
            };
            joinRef.current = doJoin;
            doJoin(location.state?.password);

            socket.on(ACTIONS.JOIN_DENIED, ({ reason }) => {
                if (reason === 'wrong-password') {
                    const wasOpen = gateOpenRef.current;
                    gateOpenRef.current = true;
                    setNeedsPassword(true);
                    if (wasOpen) setGateError('Incorrect password, try again.');
                } else {
                    toast.error('Room not found. Ask the host for a new invite.');
                    reactNavigator('/');
                }
            });

            socket.on(ACTIONS.JOINED, ({ clients, username, socketId }) => {
                if (username !== user.name) {
                    toast.success(`${username} joined the room.`);
                }
                setClients(clients);
                gateOpenRef.current = false;
                setNeedsPassword(false);
                setGateError('');
                socket.emit(ACTIONS.SYNC_CODE, {
                    code: codeRef.current,
                    socketId,
                });
            });

            socket.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
                toast.success(`${username} left the room.`);
                setClients((prev) => prev.filter((client) => client.socketId !== socketId));
            });

            socket.on(ACTIONS.CODE_CHANGE, ({ code }) => {
                editorApiRef.current?.applyRemoteCode(code);
            });
        };
        init();
        return () => {
            cancelled = true;
            const socket = socketRef.current;
            if (socket) {
                socket.off(ACTIONS.JOINED);
                socket.off(ACTIONS.DISCONNECTED);
                socket.off(ACTIONS.CODE_CHANGE);
                socket.off(ACTIONS.JOIN_DENIED);
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

    const tree = buildFileTree(
        files.map((file) => file.name),
        folders
    );

    const renderFileRow = (fileName, depth) => {
        const file = files.find((item) => item.name === fileName);
        if (!file) return null;
        const baseName = fileName.split('/').pop();
        return (
            <div
                className={`vs-tree-row${file.name === activeFile.name ? ' active' : ''}`}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                key={file.name}
                onClick={() => openFile(file.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openFile(file.name);
                    }
                }}
            >
                <LanguageIcon fileName={file.name} />
                <span className="vs-tree-label" title={file.name}>
                    {baseName}
                </span>
                {file.content !== file.savedContent && <span className="vs-dirty-dot" />}
                <button
                    className="vs-row-delete"
                    onClick={(event) => {
                        event.stopPropagation();
                        deleteFile(file.name);
                    }}
                    title={`Delete ${file.name}`}
                    aria-label={`Delete ${file.name}`}
                >
                    ×
                </button>
            </div>
        );
    };

    const renderTree = (node, prefix, depth) => (
        <React.Fragment key={prefix || 'root'}>
            {Object.keys(node.folders)
                .sort((a, b) => a.localeCompare(b))
                .map((folderName) => {
                    const folderPath = prefix ? `${prefix}/${folderName}` : folderName;
                    const isCollapsed = !!collapsedFolders[folderPath];
                    return (
                        <React.Fragment key={folderPath}>
                            <div
                                className="vs-tree-row vs-folder-row"
                                style={{ paddingLeft: `${8 + depth * 14}px` }}
                                onClick={() => toggleFolder(folderPath)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        toggleFolder(folderPath);
                                    }
                                }}
                                aria-expanded={!isCollapsed}
                            >
                                <ChevronIcon open={!isCollapsed} />
                                <FolderIcon size={15} />
                                <span className="vs-tree-label" title={folderPath}>
                                    {folderName}
                                </span>
                                <span className="vs-folder-actions">
                                    <button
                                        title={`New file in ${folderPath}`}
                                        aria-label={`New file in ${folderPath}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            addFileToFolder(folderPath);
                                        }}
                                    >
                                        +
                                    </button>
                                    <button
                                        className="danger"
                                        title={`Delete ${folderPath}`}
                                        aria-label={`Delete ${folderPath}`}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            deleteFolder(folderPath);
                                        }}
                                    >
                                        ×
                                    </button>
                                </span>
                            </div>
                            {!isCollapsed && renderTree(node.folders[folderName], folderPath, depth + 1)}
                        </React.Fragment>
                    );
                })}
            {node.files
                .slice()
                .sort((a, b) => a.localeCompare(b))
                .map((fileName) => renderFileRow(fileName, depth))}
        </React.Fragment>
    );

    return (
        <div className="vscode">
            {/* Title bar */}
            <header className="vs-titlebar">
                <div className="vs-titlebar-left">
                    <img src="/code-sync.png" alt="" />
                    <span>Code Sync</span>
                </div>
                <div className="vs-titlebar-center">
                    <button className="vs-room-chip" onClick={copyRoomId} title="Click to copy room ID">
                        {roomId.slice(0, 8)}… — click to copy invite ID
                    </button>
                </div>
                <div className="vs-titlebar-right">
                    <span className="vs-avatar">{user.name.charAt(0).toUpperCase()}</span>
                    <span className="vs-username">{user.name}</span>
                </div>
            </header>

            <div className="vs-workbench">
                {/* Activity bar */}
                <nav className="vs-activitybar" aria-label="Activity bar">
                    <button className="vs-activity-btn active" title="Explorer">
                        <FilesIcon />
                    </button>
                    <div className="vs-activity-spacer" />
                    <button className="vs-activity-btn" title="Sign out" onClick={handleLogout}>
                        <SignOutIcon />
                    </button>
                </nav>

                {/* Side bar */}
                <aside className="vs-sidebar" style={{ width: sidebarWidth }}>
                    <div className="vs-sidebar-section">
                        <div className="vs-sidebar-heading">
                            <span>EXPLORER</span>
                            <span className="vs-sidebar-actions">
                                <button
                                    title="New file"
                                    aria-label="New file"
                                    onClick={() => {
                                        setIsCreatingFolder(false);
                                        setFileError('');
                                        setNewFileName('');
                                        setIsCreatingFile((v) => !v);
                                    }}
                                >
                                    <NewFileIcon />
                                </button>
                                <button
                                    title="New folder"
                                    aria-label="New folder"
                                    onClick={() => {
                                        setIsCreatingFile(false);
                                        setFolderError('');
                                        setNewFolderName('');
                                        setIsCreatingFolder((v) => !v);
                                    }}
                                >
                                    <NewFolderIcon />
                                </button>
                            </span>
                        </div>
                        {isCreatingFile && (
                            <form
                                className="vs-new-row-form"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    createFile();
                                }}
                            >
                                <input
                                    autoFocus
                                    value={newFileName}
                                    onChange={(event) => setNewFileName(event.target.value)}
                                    onInput={() => setFileError('')}
                                    placeholder="src/example.py"
                                    aria-label="New file name"
                                />
                                {fileError && <small className="vs-form-error">{fileError}</small>}
                            </form>
                        )}
                        {isCreatingFolder && (
                            <form
                                className="vs-new-row-form"
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    createFolder();
                                }}
                            >
                                <input
                                    autoFocus
                                    value={newFolderName}
                                    onChange={(event) => setNewFolderName(event.target.value)}
                                    onInput={() => setFolderError('')}
                                    placeholder="components/nested"
                                    aria-label="New folder name"
                                />
                                {folderError && <small className="vs-form-error">{folderError}</small>}
                            </form>
                        )}
                        <div className="vs-explorer">{renderTree(tree, '', 0)}</div>
                    </div>
                    <div className="vs-sidebar-section">
                        <div className="vs-sidebar-heading">
                            <span>CONNECTED — {clients.length}</span>
                        </div>
                        <div className="vs-clients">
                            {clients.map((client) => (
                                <Client key={client.socketId} username={client.username} />
                            ))}
                        </div>
                    </div>
                </aside>
                <div
                    className="vs-sash"
                    role="separator"
                    aria-label="Resize sidebar"
                    onMouseDown={() => {
                        resizingRef.current = 'sidebar';
                        document.body.classList.add('isResizing');
                    }}
                />

                {/* Main column */}
                <div className="vs-main">
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
                        ) : (
                            <MonacoEditor
                                key={activeFile.name}
                                fileName={activeFile.name}
                                initialCode={activeFile.content}
                                language={language}
                                onCodeChange={handleLocalCodeChange}
                                onCursorChange={setCursor}
                                editorApiRef={editorApiRef}
                            />
                        )}
                    </div>

                    <div className="vs-panel">
                        <CodeRunner
                            code={activeFile.content}
                            fileName={activeFile.name}
                            files={files}
                            language={language}
                        />
                    </div>
                </div>
            </div>

            {/* Status bar */}
            <footer className="vs-statusbar">
                <div className="vs-status-left">
                    <button className="vs-status-item" onClick={copyRoomId} title="Copy room ID">
                        ⛓&nbsp;{roomId.slice(0, 8)}…
                    </button>
                    <span className="vs-status-item">👥 {clients.length} connected</span>
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
