import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { ancestorPaths, buildFileTree, splitPath, validateNewEntry } from '../fileTree';
import LanguageIcon from './LanguageIcon';
import WorkbenchIcon from './WorkbenchIcon';

const parentOf = (path) => splitPath(path).slice(0, -1).join('/');
const rootEntry = { path: '', kind: 'folder' };

export default function FileExplorer({ files, folders, activeFileName, onOpenFile, onCreateEntry, onDeleteFile, onDeleteFolder }) {
    const [selected, setSelected] = useState(rootEntry);
    const [collapsed, setCollapsed] = useState({});
    const [rootExpanded, setRootExpanded] = useState(true);
    const [draft, setDraft] = useState(null);
    const [showError, setShowError] = useState(false);
    const [contextMenu, setContextMenu] = useState(null);
    const draftRef = useRef(null);
    const inputRef = useRef(null);
    const rootRef = useRef(null);
    const treeRef = useRef(null);
    const menuRef = useRef(null);
    const sequenceRef = useRef(0);
    const fileNames = useMemo(() => files.map((file) => file.name), [files]);
    const folderNames = useMemo(() => [...new Set([
        ...folders.flatMap((path) => ancestorPaths(splitPath(path), true)),
        ...fileNames.flatMap((path) => ancestorPaths(splitPath(path))),
    ])], [folders, fileNames]);
    const tree = useMemo(() => buildFileTree(fileNames, folderNames), [fileNames, folderNames]);
    const targetParent = selected.kind === 'folder' ? selected.path : parentOf(selected.path);
    const validation = draft ? validateNewEntry(draft, fileNames, folderNames) : {};
    const error = showError ? validation.error : '';

    const updateDraft = (next) => {
        draftRef.current = next;
        setDraft(next);
    };
    const reveal = (path) => {
        setRootExpanded(true);
        setCollapsed((current) => {
            const next = { ...current };
            ancestorPaths(splitPath(path), true).forEach((folder) => { next[folder] = false; });
            return next;
        });
    };
    const restoreSelectionFocus = () => {
        requestAnimationFrame(() => {
            const row = [...(treeRef.current?.querySelectorAll('[data-explorer-path]') || [])]
                .find((element) => element.dataset.explorerPath === selected.path);
            (row || rootRef.current)?.focus();
        });
    };

    useEffect(() => {
        setSelected({ path: activeFileName, kind: 'file' });
        reveal(parentOf(activeFileName));
    }, [activeFileName]);

    useEffect(() => {
        const existing = selected.kind === 'file' ? fileNames : folderNames;
        if (selected.path && !existing.includes(selected.path)) setSelected(rootEntry);
        if (draft?.parent && !folderNames.includes(draft.parent)) {
            draftRef.current = null;
            setDraft(null);
            toast.error('The destination folder was removed. Choose another folder.');
        }
        if (contextMenu?.entry.path && !(contextMenu.entry.kind === 'file' ? fileNames : folderNames).includes(contextMenu.entry.path)) {
            setContextMenu(null);
        }
    }, [fileNames, folderNames, selected, draft?.parent, contextMenu]);

    useLayoutEffect(() => {
        if (!draft) return;
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ block: 'nearest' });
    }, [draft?.id]);

    useLayoutEffect(() => {
        if (!contextMenu) return;
        const menu = menuRef.current;
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(contextMenu.x, window.innerWidth - rect.width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(contextMenu.y, window.innerHeight - rect.height - 8))}px`;
        menu.querySelector('[role="menuitem"]')?.focus();
        const dismiss = (event) => { if (!menu.contains(event.target)) setContextMenu(null); };
        const close = () => setContextMenu(null);
        document.addEventListener('pointerdown', dismiss);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            window.removeEventListener('resize', close);
            window.removeEventListener('scroll', close, true);
        };
    }, [contextMenu]);

    const startCreation = (kind, parent = targetParent) => {
        setContextMenu(null);
        setSelected({ path: parent, kind: 'folder' });
        reveal(parent);
        setShowError(false);
        updateDraft({ id: ++sequenceRef.current, kind, parent, name: '' });
    };
    const cancelCreation = (restoreFocus = false) => {
        updateDraft(null);
        setShowError(false);
        if (restoreFocus) restoreSelectionFocus();
    };
    const commitCreation = (fromBlur = false) => {
        const current = draftRef.current;
        if (!current) return;
        if (fromBlur && !current.name.trim()) { cancelCreation(); return; }
        const result = validateNewEntry(current, fileNames, folderNames);
        if (result.error) { setShowError(true); return; }
        // Consume the draft before its input blurs on unmount, avoiding a
        // duplicate local/socket creation after Enter or a pointer submission.
        updateDraft(null);
        setShowError(false);
        reveal(current.kind === 'folder' ? result.path : parentOf(result.path));
        setSelected({ path: result.path, kind: current.kind });
        onCreateEntry({ kind: current.kind, path: result.path, folders: result.folders });
        if (current.kind === 'folder' && !fromBlur) {
            requestAnimationFrame(() => {
                [...(treeRef.current?.querySelectorAll('[data-explorer-path]') || [])]
                    .find((row) => row.dataset.explorerPath === result.path)?.focus();
            });
        }
    };
    const openMenu = (event, entry) => {
        event.preventDefault();
        event.stopPropagation();
        setSelected(entry);
        setContextMenu({ entry, x: event.clientX, y: event.clientY });
    };
    const selectFolder = (path) => {
        if (draft && (draft.parent === path || draft.parent.startsWith(`${path}/`))) cancelCreation();
        setSelected({ path, kind: 'folder' });
        setCollapsed((current) => ({ ...current, [path]: !(Object.hasOwn(current, path) && current[path]) }));
    };
    const openFile = (path) => {
        setSelected({ path, kind: 'file' });
        onOpenFile(path);
    };
    const rowKeyDown = (event, entry, activate) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
        } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            setSelected(entry);
            setContextMenu({ entry, x: rect.left + 20, y: rect.bottom });
        } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const rows = [...treeRef.current.querySelectorAll('[data-explorer-path]')];
            const index = rows.indexOf(event.currentTarget);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
                Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
            rows[next]?.focus();
        } else if (entry.kind === 'folder' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
            event.preventDefault();
            if (!entry.path) setRootExpanded(event.key === 'ArrowRight');
            else setCollapsed((current) => ({ ...current, [entry.path]: event.key === 'ArrowLeft' }));
        }
    };

    const renderDraft = (parent, depth, kind) => {
        if (!draft || draft.parent !== parent || draft.kind !== kind) return null;
        return (
            <form
                key={`new-${draft.id}`}
                className="vs-inline-create"
                data-parent-path={parent}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onSubmit={(event) => { event.preventDefault(); commitCreation(); }}
                onContextMenu={(event) => event.stopPropagation()}
            >
                <span className="vs-inline-create-icon">
                    {kind === 'folder' ? <><span className="vs-tree-indent" /><WorkbenchIcon name="folder" size={15} /></> :
                        draft.name ? <LanguageIcon fileName={draft.name} /> : <WorkbenchIcon name="file" size={15} />}
                </span>
                <div className="vs-inline-create-field">
                    <input
                        ref={inputRef}
                        value={draft.name}
                        aria-label={`New ${kind} name`}
                        aria-invalid={!!error}
                        aria-describedby={error ? 'explorer-create-error' : 'explorer-create-hint'}
                        title={`Create in ${parent || 'ROOM FILES'}`}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(event) => updateDraft({ ...draft, name: event.target.value })}
                        onBlur={() => commitCreation(true)}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Escape') { event.preventDefault(); cancelCreation(true); }
                            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
                        }}
                    />
                    {error ? <div className="vs-inline-create-error" id="explorer-create-error" role="alert">{error}</div> :
                        <span className="vs-sr-only" id="explorer-create-hint">Creating in {parent || 'ROOM FILES'}. Enter to create, Escape to cancel.</span>}
                </div>
            </form>
        );
    };
    const renderTree = (node, prefix = '', depth = 0) => (
        <React.Fragment key={prefix || 'root'}>
            {renderDraft(prefix, depth, 'folder')}
            {Object.keys(node.folders).sort((a, b) => a.localeCompare(b)).map((name) => {
                const path = prefix ? `${prefix}/${name}` : name;
                const expanded = !(Object.hasOwn(collapsed, path) && collapsed[path]);
                const entry = { path, kind: 'folder' };
                return (
                    <div className="vs-folder-group" key={path} data-folder-path={path}>
                        <div
                            className={`vs-tree-row vs-folder-row${selected.path === path ? ' selected' : ''}`}
                            style={{ paddingLeft: `${8 + depth * 14}px` }}
                            role="button" tabIndex={0} aria-expanded={expanded}
                            data-explorer-path={path}
                            onFocus={(event) => { if (event.target === event.currentTarget) setSelected(entry); }}
                            onClick={() => selectFolder(path)}
                            onKeyDown={(event) => rowKeyDown(event, entry, () => selectFolder(path))}
                            onContextMenu={(event) => openMenu(event, entry)}
                        >
                            <span className={`vs-explorer-chevron${expanded ? ' open' : ''}`}><WorkbenchIcon name="chevron" size={14} /></span>
                            <WorkbenchIcon name="folder" size={15} />
                            <span className="vs-tree-label" title={path}>{name}</span>
                            <span className="vs-folder-actions">
                                <button aria-label={`New file in ${path}`} title="New File…" onClick={(event) => { event.stopPropagation(); startCreation('file', path); }}><WorkbenchIcon name="new-file" size={13} /></button>
                                <button aria-label={`New folder in ${path}`} title="New Folder…" onClick={(event) => { event.stopPropagation(); startCreation('folder', path); }}><WorkbenchIcon name="new-folder" size={13} /></button>
                                <button className="danger" aria-label={`Delete ${path}`} title={`Delete ${path}`} onClick={(event) => { event.stopPropagation(); onDeleteFolder(path); }}>×</button>
                            </span>
                        </div>
                        {expanded && <div className="vs-folder-children">{renderTree(node.folders[name], path, depth + 1)}</div>}
                    </div>
                );
            })}
            {renderDraft(prefix, depth, 'file')}
            {node.files.slice().sort((a, b) => a.localeCompare(b)).map((path) => {
                const file = files.find((item) => item.name === path);
                const entry = { path, kind: 'file' };
                return (
                    <div
                        key={path}
                        className={`vs-tree-row${path === activeFileName ? ' active' : ''}${selected.path === path ? ' selected' : ''}`}
                        style={{ paddingLeft: `${8 + depth * 14}px` }}
                        role="button" tabIndex={0} data-explorer-path={path}
                        onClick={() => openFile(path)}
                        onFocus={(event) => { if (event.target === event.currentTarget) setSelected(entry); }}
                        onKeyDown={(event) => rowKeyDown(event, entry, () => openFile(path))}
                        onContextMenu={(event) => openMenu(event, entry)}
                    >
                        <LanguageIcon fileName={path} />
                        <span className="vs-tree-label" title={path}>{path.split('/').pop()}</span>
                        {file.content !== file.savedContent && <span className="vs-dirty-dot" />}
                        <button className="vs-row-delete" aria-label={`Delete ${path}`} title={`Delete ${path}`} onClick={(event) => { event.stopPropagation(); onDeleteFile(path); }}>×</button>
                    </div>
                );
            })}
        </React.Fragment>
    );

    return (
        <div className="vs-file-explorer">
            <div className="vs-sidebar-heading">
                <span>EXPLORER <span className="vs-file-count">{files.length}</span></span>
                <span className="vs-sidebar-actions">
                    <button aria-label="New file" title={`New File… in ${targetParent || 'ROOM FILES'}`} onClick={() => startCreation('file')}><WorkbenchIcon name="new-file" /></button>
                    <button aria-label="New folder" title={`New Folder… in ${targetParent || 'ROOM FILES'}`} onClick={() => startCreation('folder')}><WorkbenchIcon name="new-folder" /></button>
                </span>
            </div>
            <div ref={treeRef} className="vs-explorer-tree" aria-label="Explorer files" role="region" onContextMenu={(event) => openMenu(event, rootEntry)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(rootEntry); }}>
                <div
                    ref={rootRef}
                    className={`vs-project-root${selected.path === '' ? ' selected' : ''}`}
                    role="button" tabIndex={0} aria-label="ROOM FILES" aria-expanded={rootExpanded} data-explorer-path=""
                    onFocus={(event) => { if (event.target === event.currentTarget) setSelected(rootEntry); }}
                    onClick={() => { setSelected(rootEntry); setRootExpanded((current) => !current); cancelCreation(); }}
                    onKeyDown={(event) => rowKeyDown(event, rootEntry, () => { setSelected(rootEntry); setRootExpanded((current) => !current); cancelCreation(); })}
                >
                    <span className={`vs-explorer-chevron${rootExpanded ? ' open' : ''}`}><WorkbenchIcon name="chevron" size={14} /></span>
                    <WorkbenchIcon name="folder" size={14} /><span>ROOM FILES</span>
                </div>
                <div className="vs-explorer" onClick={(event) => { if (event.target === event.currentTarget) setSelected(rootEntry); }}>{rootExpanded && renderTree(tree)}</div>
            </div>
            <div className="vs-explorer-footer"><span className="vs-shortcut-key">Ctrl S</span><span>Save current file</span></div>
            {contextMenu && (
                <div
                    ref={menuRef}
                    className="vs-explorer-context-menu" role="menu" aria-label="Explorer actions"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onContextMenu={(event) => event.preventDefault()}
                    onKeyDown={(event) => {
                        const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
                        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                            event.preventDefault();
                            const index = items.indexOf(document.activeElement);
                            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
                                (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                            items[next]?.focus();
                        } else if (event.key === 'Escape' || event.key === 'Tab') {
                            event.preventDefault(); setContextMenu(null); restoreSelectionFocus();
                        }
                    }}
                >
                    <span className="vs-explorer-menu-location">{(contextMenu.entry.kind === 'folder' ? contextMenu.entry.path : parentOf(contextMenu.entry.path)) || 'ROOM FILES'}</span>
                    <button role="menuitem" onClick={() => startCreation('file', contextMenu.entry.kind === 'folder' ? contextMenu.entry.path : parentOf(contextMenu.entry.path))}><WorkbenchIcon name="new-file" />New File…</button>
                    <button role="menuitem" onClick={() => startCreation('folder', contextMenu.entry.kind === 'folder' ? contextMenu.entry.path : parentOf(contextMenu.entry.path))}><WorkbenchIcon name="new-folder" />New Folder…</button>
                </div>
            )}
        </div>
    );
}
