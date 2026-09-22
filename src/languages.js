const LANGUAGES = {
    javascript: {
        label: 'JavaScript',
        extensions: ['js', 'jsx'],
        mode: 'javascript',
        judge0Id: 63,
    },
    python: {
        label: 'Python',
        extensions: ['py'],
        mode: 'python',
        judge0Id: 71,
    },
    java: {
        label: 'Java',
        extensions: ['java'],
        mode: 'text/x-java',
        judge0Id: 62,
    },
    cpp: {
        label: 'C++',
        extensions: ['cpp', 'cc', 'cxx'],
        mode: 'text/x-c++src',
        judge0Id: 54,
    },
    c: {
        label: 'C',
        extensions: ['c', 'h'],
        mode: 'text/x-csrc',
        judge0Id: 50,
    },
    csharp: {
        label: 'C#',
        extensions: ['cs'],
        mode: 'text/x-csharp',
        judge0Id: 51,
    },
    go: {
        label: 'Go',
        extensions: ['go'],
        mode: 'go',
        judge0Id: 60,
    },
    rust: {
        label: 'Rust',
        extensions: ['rs'],
        mode: 'rust',
        judge0Id: 73,
    },
    typescript: {
        label: 'TypeScript',
        extensions: ['ts', 'tsx'],
        mode: 'javascript',
        judge0Id: 74,
    },
    ruby: {
        label: 'Ruby',
        extensions: ['rb'],
        mode: 'ruby',
        judge0Id: 72,
    },
    php: {
        label: 'PHP',
        extensions: ['php'],
        mode: 'php',
        judge0Id: 68,
    },
    kotlin: {
        label: 'Kotlin',
        extensions: ['kt', 'kts'],
        mode: 'text/x-kotlin',
        judge0Id: 78,
    },
    swift: {
        label: 'Swift',
        extensions: ['swift'],
        mode: 'text/x-swift',
        judge0Id: 83,
    },
    sql: {
        label: 'SQL',
        extensions: ['sql'],
        mode: 'text/x-sql',
        judge0Id: 82,
    },
    plaintext: {
        label: 'Plain text',
        extensions: ['txt'],
        mode: null,
        judge0Id: null,
    },
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