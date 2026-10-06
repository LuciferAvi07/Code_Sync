import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import WorkbenchIcon from './WorkbenchIcon';
import { apiFetch } from '../api';
import { buildPreviewDocument } from '../preview';

const CodeRunner = forwardRef(({ code, fileName, language, files = [], style, disabled = false }, ref) => {
    const [stdin, setStdin] = useState('');
    const [output, setOutput] = useState('Run the selected file to see its output.');
    const [isRunning, setIsRunning] = useState(false);
    const [previewDoc, setPreviewDoc] = useState(null);
    const isPreview = language.runner === 'preview';
    const requestRef = useRef(null);

    useEffect(() => () => requestRef.current?.abort(), []);

    useEffect(() => {
        setPreviewDoc(null);
        setOutput('Run the selected file to see its output.');
    }, [fileName]);

    const runCode = async () => {
        if (disabled || isRunning) return;
        if (isPreview) {
            setPreviewDoc(buildPreviewDocument(fileName, files, code));
            setOutput('Preview rendered below. Press Run Code again after editing.');
            return;
        }

        if (!language.judge0Id) {
            setOutput(`${language.label} files cannot be executed yet.`);
            return;
        }

        setIsRunning(true);
        setOutput(`Running ${fileName}...`);
        const controller = new AbortController();
        requestRef.current = controller;

        const sourceCode =
            language.label === 'Java'
                ? code.replace(
                      /public\s+class\s+[A-Za-z_$][\w$]*/,
                      'public class Main'
                  )
                : code;

        try {
            const result = await apiFetch('/api/execute', {
                method: 'POST',
                token: localStorage.getItem('code-sync-token'),
                signal: controller.signal,
                body: JSON.stringify({
                    sourceCode,
                    languageId: language.judge0Id,
                    stdin,
                }),
            });
            const status = result.statusId && result.statusId !== 3 ? `${result.status}\n` : '';
            const metrics = result.time != null || result.memory != null
                ? `\n\nTime: ${result.time ?? '—'} s · Memory: ${result.memory ?? '—'} KB` : '';
            setOutput(`${status}${result.output || (result.statusId === 3 ? 'Program completed without output.' : '')}${metrics}`);
        } catch (error) {
            if (controller.signal.aborted) return;
            setOutput(`Execution error: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    useImperativeHandle(ref, () => ({ run: runCode }));

    return (
        <section className="runnerPanel" style={style}>
            <div className="runnerHeader">
                <div className="panelTabs">
                    <span className="panelTab active">{isPreview ? 'PREVIEW' : 'OUTPUT'}</span>
                    <span className="runner-file-name" title={fileName}>{fileName}</span>
                </div>
                <button className="btn runBtn" onClick={runCode} disabled={disabled || isRunning}>
                    <WorkbenchIcon name="play" size={12} />{isRunning ? 'Running...' : 'Run Code'}
                </button>
            </div>
            {!isPreview && (
                <input
                    className="stdinInput"
                    value={stdin}
                    onChange={(event) => setStdin(event.target.value)}
                    placeholder="Program input (optional)"
                    aria-label="Program input"
                />
            )}
            {isPreview && previewDoc ? (
                <iframe
                    className="previewFrame"
                    title={`${fileName} preview`}
                    srcDoc={previewDoc}
                    sandbox="allow-scripts allow-modals allow-forms allow-popups"
                />
            ) : (
                <pre className="outputPanel">{output}</pre>
            )}
        </section>
    );
});

export default CodeRunner;
