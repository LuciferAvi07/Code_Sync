import React, { useEffect, useState } from 'react';
import { API_BASE } from '../api';
import { buildPreviewDocument } from '../preview';

const CodeRunner = ({ code, fileName, language, files = [], style }) => {
    const [stdin, setStdin] = useState('');
    const [output, setOutput] = useState('Run the selected file to see its output.');
    const [isRunning, setIsRunning] = useState(false);
    const [previewDoc, setPreviewDoc] = useState(null);
    const isPreview = language.runner === 'preview';

    useEffect(() => {
        setPreviewDoc(null);
        setOutput('Run the selected file to see its output.');
    }, [fileName]);

    const runCode = async () => {
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

        const sourceCode =
            language.label === 'Java'
                ? code.replace(
                      /public\s+class\s+[A-Za-z_$][\w$]*/,
                      'public class Main'
                  )
                : code;

        try {
            const response = await fetch(`${API_BASE}/api/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('code-sync-token') || ''}`,
                },
                body: JSON.stringify({
                    sourceCode,
                    languageId: language.judge0Id,
                    stdin,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Execution failed.');
            setOutput(result.output || 'Program completed without output.');
        } catch (error) {
            setOutput(`Execution error: ${error.message}`);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <section className="runnerPanel" style={style}>
            <div className="runnerHeader">
                <div className="panelTabs">
                    <span className="panelTab active">{isPreview ? 'PREVIEW' : 'OUTPUT'}</span>
                </div>
                <button className="btn runBtn" onClick={runCode} disabled={isRunning}>
                    {isRunning ? 'Running...' : '▷ Run Code'}
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
};

export default CodeRunner;
