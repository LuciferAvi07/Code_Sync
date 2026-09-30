import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

const MONACO_OPTIONS = {
    fontSize: 14,
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    fontLigatures: true,
    minimap: { enabled: true },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    cursorBlinking: 'smooth',
    padding: { top: 12 },
    renderLineHighlight: 'all',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    stickyScroll: { enabled: true },
    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};

// A thin wrapper around Monaco (the editor that powers VS Code).
// Local edits flow out through onCodeChange; remote edits are applied via
// the api object registered on editorApiRef, preserving cursor + scroll.
const MonacoEditor = ({
    fileName,
    initialCode,
    language,
    onCodeChange,
    onCursorChange,
    editorApiRef,
}) => {
    const editorRef = useRef(null);
    const suppressLocalRef = useRef(false);
    const onCodeChangeRef = useRef(onCodeChange);
    onCodeChangeRef.current = onCodeChange;

    const handleMount = (editor) => {
        editorRef.current = editor;

        editor.onDidChangeModelContent(() => {
            if (suppressLocalRef.current) return;
            onCodeChangeRef.current(editor.getValue());
        });

        editor.onDidChangeCursorPosition((e) => {
            onCursorChange?.(e.position);
        });

        if (editorApiRef) {
            editorApiRef.current = {
                // Applies code received from another user. This only touches
                // the local editor view: it must NOT call onCodeChange, or the
                // remote edit would be re-broadcast to the room and ping-pong
                // back to its author (an echo storm that garbles both files).
                // EditorPage updates its own file state for the matching path.
                applyRemoteCode(code) {
                    const ed = editorRef.current;
                    if (!ed || code === null || code === undefined) return;
                    const model = ed.getModel();
                    if (!model || model.getValue() === code) return;
                    suppressLocalRef.current = true;
                    try {
                        const viewState = ed.saveViewState();
                        ed.executeEdits('remote', [
                            { range: model.getFullModelRange(), text: code },
                        ]);
                        if (viewState) ed.restoreViewState(viewState);
                    } finally {
                        suppressLocalRef.current = false;
                    }
                },
                focus() {
                    editorRef.current?.focus();
                },
            };
        }

        editor.focus();
    };

    useEffect(() => {
        return () => {
            if (editorApiRef) editorApiRef.current = null;
            editorRef.current = null;
        };
    }, [editorApiRef]);

    return (
        <Editor
            height="100%"
            width="100%"
            path={fileName}
            defaultLanguage={language.monaco || 'plaintext'}
            defaultValue={initialCode}
            theme="vs-dark"
            options={MONACO_OPTIONS}
            onMount={handleMount}
            loading={
                <div className="monaco-loading">Loading editor…</div>
            }
        />
    );
};

export default MonacoEditor;
