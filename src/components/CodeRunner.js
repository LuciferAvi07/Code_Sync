import React, { useState } from 'react';

const CodeRunner = ({ code, fileName, language, style }) => {
    const [stdin, setStdin] = useState('');
    const [output, setOutput] = useState('Run the selected file to see its output.');
    const [isRunning, setIsRunning] = useState(false);

    const runCode = async () => {
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
            const response = await fetch('/api/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
                <h3>Output</h3>
                <button className="btn runBtn" onClick={runCode} disabled={isRunning}>
                    {isRunning ? 'Running...' : 'Run Code'}
                </button>
            </div>
            <input
                className="stdinInput"
                value={stdin}
                onChange={(event) => setStdin(event.target.value)}
                placeholder="Program input (optional)"
                aria-label="Program input"
            />
            <pre className="outputPanel">{output}</pre>
        </section>
    );
};

export default CodeRunner;