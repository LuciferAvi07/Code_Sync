import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import '../monaco';

const MONACO_OPTIONS = {
    fontSize: 14,
    lineHeight: 24,
    fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
    fontLigatures: true,
    minimap: { enabled: true },
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    cursorBlinking: 'smooth',
    padding: { top: 18, bottom: 16 },
    lineNumbersMinChars: 4,
    overviewRulerBorder: false,
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

const defineTheme = (monaco) => monaco.editor.defineTheme('codesync-glass', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'comment', foreground: '687B96', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'C3A6FF' },
        { token: 'string', foreground: 'A5D6A7' },
        { token: 'number', foreground: 'E9C58A' },
    ],
    colors: {
        'editor.background': '#101722',
        'editor.foreground': '#D1DBEC',
        'editorLineNumber.foreground': '#465570',
        'editorLineNumber.activeForeground': '#9AACC7',
        'editor.lineHighlightBackground': '#FFFFFF03',
        'editor.lineHighlightBorder': '#FFFFFF04',
        'editor.selectionBackground': '#6C8FFF30',
        'editor.inactiveSelectionBackground': '#6C8FFF15',
        'editorCursor.foreground': '#8CE3CA',
        'editorIndentGuide.background1': '#FFFFFF08',
        'editorIndentGuide.activeBackground1': '#FFFFFF18',
        'editorWidget.background': '#182231',
        'editorWidget.border': '#2C3B50',
        'editorGutter.background': '#101722',
        'scrollbarSlider.background': '#7283A022',
        'scrollbarSlider.hoverBackground': '#7283A044',
        'minimap.background': '#101722',
    },
});

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
    const latestCodeRef = useRef(initialCode);
    latestCodeRef.current = initialCode;

    const applyCode = (code) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!model || model.getValue() === code) return;
        suppressLocalRef.current = true;
        try {
            const viewState = editor.saveViewState();
            editor.executeEdits('remote', [{ range: model.getFullModelRange(), text: code }]);
            if (viewState) editor.restoreViewState(viewState);
        } finally {
            suppressLocalRef.current = false;
        }
    };

    // A reconnect snapshot changes props without remounting the active file.
    useEffect(() => { applyCode(initialCode); }, [initialCode]);

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
                applyRemoteCode: applyCode,
                focus() {
                    editorRef.current?.focus();
                },
            };
        }

        applyCode(latestCodeRef.current);
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
            theme="codesync-glass"
            beforeMount={defineTheme}
            options={MONACO_OPTIONS}
            onMount={handleMount}
            loading={
                <div className="monaco-loading">Loading editor…</div>
            }
        />
    );
};

export default MonacoEditor;
