const LANGUAGES = {
    javascript: { label: 'JavaScript', extensions: ['js', 'jsx'], mode: 'javascript', monaco: 'javascript', judge0Id: 63 },
    python:     { label: 'Python',     extensions: ['py'],          mode: 'python',     monaco: 'python',     judge0Id: 71 },
    java:       { label: 'Java',       extensions: ['java'],       mode: 'text/x-java', monaco: 'java',      judge0Id: 62 },
    cpp:        { label: 'C++',        extensions: ['cpp', 'cc', 'cxx'], mode: 'text/x-c++src', monaco: 'cpp', judge0Id: 54 },
    c:          { label: 'C',          extensions: ['c', 'h'],      mode: 'text/x-csrc', monaco: 'c',          judge0Id: 50 },
    csharp:     { label: 'C#',         extensions: ['cs'],         mode: 'text/x-csharp', monaco: 'csharp',   judge0Id: 51 },
    go:         { label: 'Go',         extensions: ['go'],         mode: 'go',          monaco: 'go',         judge0Id: 60 },
    rust:       { label: 'Rust',       extensions: ['rs'],         mode: 'rust',        monaco: 'rust',       judge0Id: 73 },
    typescript: { label: 'TypeScript', extensions: ['ts', 'tsx'],   mode: 'javascript',  monaco: 'typescript', judge0Id: 74 },
    ruby:       { label: 'Ruby',       extensions: ['rb'],         mode: 'ruby',        monaco: 'ruby',       judge0Id: 72 },
    php:        { label: 'PHP',        extensions: ['php'],        mode: 'php',         monaco: 'php',        judge0Id: 68 },
    kotlin:     { label: 'Kotlin',     extensions: ['kt', 'kts'],  mode: 'text/x-kotlin', monaco: 'kotlin',   judge0Id: 78 },
    swift:      { label: 'Swift',      extensions: ['swift'],      mode: 'text/x-swift', monaco: 'swift',     judge0Id: 83 },
    sql:        { label: 'SQL',        extensions: ['sql'],        mode: 'text/x-sql',  monaco: 'sql',        judge0Id: 82 },
    html:       { label: 'HTML',       extensions: ['html', 'htm'], mode: 'htmlmixed',   monaco: 'html',       judge0Id: null, runner: 'preview' },
    css:        { label: 'CSS',        extensions: ['css'],        mode: 'css',         monaco: 'css',        judge0Id: null, runner: 'preview' },
    plaintext:  { label: 'Plain text', extensions: ['txt'],        mode: null,          monaco: 'plaintext',  judge0Id: null },
};

export const getLanguageForFile = (fileName) => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return (
        Object.values(LANGUAGES).find((language) =>
            language.extensions.includes(extension)
        ) || LANGUAGES.javascript
    );
};

export const getLanguageKey = (fileName) => {
    const language = getLanguageForFile(fileName);
    return Object.keys(LANGUAGES).find((key) => LANGUAGES[key] === language);
};

export default LANGUAGES;
