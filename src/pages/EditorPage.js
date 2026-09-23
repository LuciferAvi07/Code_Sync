import React, { useState, useRef, useEffect } from 'react';
import toast from 'react-hot-toast';
import ACTIONS from '../Actions';
import Client from '../components/Client';
import Editor from '../components/Editor';
import CodeRunner from '../components/CodeRunner';
import { getLanguageForFile } from '../languages';
import { initSocket } from '../socket';
import {
    useLocation,
    useNavigate,
    Navigate,
    useParams,
} from 'react-router-dom';

const FileIcon = () => (
    <img className="fileIconImage" src="/new-file.svg" alt="" aria-hidden="true" />
);

const LanguageIcon = ({ fileName }) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    const languageAssets = {
        js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
        py: 'python', java: 'java', cpp: 'cplusplus', cc: 'cplusplus',
        cxx: 'cplusplus', c: 'c', h: 'c', cs: 'csharp', go: 'go', rs: 'rust',
        rb: 'ruby', php: 'php', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
        sql: 'database',
    };
    const assetName = languageAssets[extension];
    return <span className={`languageIcon language-${extension || 'file'}`} title={getLanguageForFile(fileName).label}>
        {assetName ? (
            <img src={`https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${assetName}/${assetName}-original.svg`} alt="" aria-hidden="true" />
        ) : <span className="languageFallback">FILE</span>}
    </span>;
};

const EditorPage = () => {
    const socketRef = useRef(null);
    const codeRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const reactNavigator = useNavigate();
    const [clients, setClients] = useState([]);
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
    const [isFilesOpen, setIsFilesOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(230);
    const [outputHeight, setOutputHeight] = useState(260);
    const resizingRef = useRef(null);
    const activeFile =
        files.find((file) => file.name === activeFileName) || files[0];
    const language = getLanguageForFile(activeFile.name);

    useEffect(() => {
        localStorage.setItem(
            storageKey,
            JSON.stringify({ files, activeFileName, openFileNames })
        );
    }, [activeFileName, files, openFileNames, storageKey]);

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
                setSidebarWidth(Math.min(420, Math.max(180, event.clientX)));
            }
            if (resizingRef.current === 'output') {
                setOutputHeight(Math.min(520, Math.max(150, window.innerHeight - event.clientY)));
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

    function updateActiveFile(code) {
        codeRef.current = code;
        setFiles((currentFiles) =>
            currentFiles.map((file) =>
                file.name === activeFile.name ? { ...file, content: code } : file
            )
        );
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
        const name = newFileName.trim();
        if (!name) return;
        if (!/^[^./\\]+\.[^./\\]+$/.test(name)) {
            setFileError('File should have the extension');
            return;
        }
        if (files.some((file) => file.name === name)) {
            setFileError('A file with this name already exists');
            return;
        }

        const newFile = { name, content: '', savedContent: '' };
        setFiles((currentFiles) => [...currentFiles, newFile]);
        openFile(newFile.name);
        setNewFileName('');
        setFileError('');
        setIsCreatingFile(false);
    }

    function deleteActiveFile() {
        if (files.length === 1) {
            toast.error('A room must have at least one file.');
            return;
        }

        const remainingFiles = files.filter(
            (file) => file.name !== activeFile.name
        );
        setFiles(remainingFiles);
        closeTab(activeFile.name);
        setActiveFileName(remainingFiles[0].name);
    }

    useEffect(() => {
        const init = async () => {
            socketRef.current = await initSocket();
            socketRef.current.on('connect_error', (err) => handleErrors(err));
            socketRef.current.on('connect_failed', (err) => handleErrors(err));

            function handleErrors(e) {
                console.log('socket error', e);
                toast.error('Socket connection failed, try again later.');
                reactNavigator('/');
            }

            socketRef.current.emit(ACTIONS.JOIN, {
                roomId,
                username: location.state?.username,
            });

            // Listening for joined event
            socketRef.current.on(
                ACTIONS.JOINED,
                ({ clients, username, socketId }) => {
                    if (username !== location.state?.username) {
                        toast.success(`${username} joined the room.`);
                        console.log(`${username} joined`);
                    }
                    setClients(clients);
                    socketRef.current.emit(ACTIONS.SYNC_CODE, {
                        code: codeRef.current,
                        socketId,
                    });
                }
            );

            // Listening for disconnected
            socketRef.current.on(
                ACTIONS.DISCONNECTED,
                ({ socketId, username }) => {
                    toast.success(`${username} left the room.`);
                    setClients((prev) => {
                        return prev.filter(
                            (client) => client.socketId !== socketId
                        );
                    });
                }
            );
        };
        init();
        return () => {
            socketRef.current.disconnect();
            socketRef.current.off(ACTIONS.JOINED);
            socketRef.current.off(ACTIONS.DISCONNECTED);
        };
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

    function leaveRoom() {
        reactNavigator('/');
    }

    if (!location.state) {
        return <Navigate to="/" />;
    }

    return (
        <div className="mainWrap" style={{ gridTemplateColumns: `${sidebarWidth}px 6px minmax(0, 1fr)` }}>
            <div className="aside">
                <div className="asideInner">
                    <div className="logo">
                        <img
                            className="logoImage"
                            src="/code-sync.png"
                            alt="logo"
                        />
                    </div>
                    <h3>Connected</h3>
                    <div className="clientsList">
                        {clients.map((client) => (
                            <Client
                                key={client.socketId}
                                username={client.username}
                            />
                        ))}
                    </div>
                    <div className="filesHeader">
                        <button
                            className="filesToggle"
                            onClick={() => setIsFilesOpen((isOpen) => !isOpen)}
                            title={isFilesOpen ? 'Collapse files' : 'Expand files'}
                            aria-label={isFilesOpen ? 'Collapse files' : 'Expand files'}
                            aria-expanded={isFilesOpen}
                        >
                            <FileIcon />
                            <svg className="chevronIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                        </button>
                        <button
                            className="iconBtn"
                            onClick={() => {
                                setIsFilesOpen(true);
                                setIsCreatingFile(true);
                            }}
                            title="Create a new file"
                            aria-label="Create a new file"
                        >
                            <FileIcon />
                        </button>
                    </div>
                    {isFilesOpen && isCreatingFile && (
                        <form
                            className="newFileForm"
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
                                placeholder="example.py"
                                aria-label="New file name"
                            />
                                {fileError && <small className="fileError">{fileError}</small>}
                        </form>
                    )}
                    {isFilesOpen && <div className="filesList">
                        {files.map((file) => (
                            <div
                                className={`fileItem ${
                                    file.name === activeFile.name ? 'active' : ''
                                }`}
                                key={file.name}
                                onClick={() => openFile(file.name)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        openFile(file.name);
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                            >
                                <span className="fileName">
                                    <span className="fileLabel"><LanguageIcon fileName={file.name} /><span>{file.name}</span></span>
                                    <button
                                        className="deleteFileBtn"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (file.name === activeFile.name) {
                                                deleteActiveFile();
                                            } else if (files.length > 1) {
                                                setFiles((currentFiles) =>
                                                    currentFiles.filter((item) => item.name !== file.name)
                                                );
                                                closeTab(file.name);
                                            }
                                        }}
                                        title={`Delete ${file.name}`}
                                        aria-label={`Delete ${file.name}`}
                                    >
                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                            <path d="M3 6h18M9 6V4h6v2M19 6l-1 14H6L5 6M10 11v5M14 11v5" />
                                        </svg>
                                    </button>
                                </span>
                                <small>{getLanguageForFile(file.name).label}</small>
                            </div>
                        ))}
                    </div>}
                </div>
                <button className="btn copyBtn" onClick={copyRoomId}>
                    Copy ROOM ID
                </button>
                <button className="btn leaveBtn" onClick={leaveRoom}>
                    Leave
                </button>
            </div>
            <div
                className="sidebarResizeHandle"
                role="separator"
                aria-label="Resize sidebar"
                onMouseDown={() => {
                    resizingRef.current = 'sidebar';
                    document.body.classList.add('isResizing');
                }}
            />
            <div className="editorWrap">
                <nav className="fileTabs" aria-label="Open files">
                    {openFileNames.map((fileName) => {
                        const file = files.find((item) => item.name === fileName);
                        if (!file) return null;
                        return (
                            <div className={`fileTab ${fileName === activeFile.name ? 'active' : ''}`} key={fileName}>
                                <button className="fileTabButton" onClick={() => setActiveFileName(fileName)}>
                                    <LanguageIcon fileName={fileName} />
                                    <span className="tabFileName">{fileName}</span>
                                    {file.content !== file.savedContent && <span className="dirtyDot" aria-label="Unsaved changes" />}
                                </button>
                                {openFileNames.length > 1 && (
                                    <button className="closeTabButton" onClick={() => closeTab(fileName)} aria-label={`Close ${fileName}`}>
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </nav>
                <div className="editorMount" key={activeFile.name}>
                    <Editor
                        socketRef={socketRef}
                        roomId={roomId}
                        initialCode={activeFile.content}
                        language={language}
                        onCodeChange={updateActiveFile}
                    />
                </div>
                <div className="fileActions">
                    <span>{activeFile.name} · {language.label}</span>
                </div>
                <div
                    className="outputResizeHandle"
                    role="separator"
                    aria-label="Resize output panel"
                    onMouseDown={() => {
                        resizingRef.current = 'output';
                        document.body.classList.add('isResizing');
                    }}
                />
                <CodeRunner
                    code={activeFile.content}
                    fileName={activeFile.name}
                    language={language}
                    style={{ height: outputHeight }}
                />
            </div>
        </div>
    );
};

export default EditorPage;
