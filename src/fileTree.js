export const normalizePath = (value) =>
    String(value || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');

export const splitPath = (path) =>
    String(path || '')
        .split('/')
        .filter(Boolean);

export const hasTraversalSegments = (segments) =>
    segments.some((segment) => segment === '.' || segment === '..');

export const ancestorPaths = (segments, includeSelf = false) => {
    const paths = [];
    const last = includeSelf ? segments.length : segments.length - 1;
    for (let i = 1; i <= last; i += 1) {
        paths.push(segments.slice(0, i).join('/'));
    }
    return paths;
};

export const isUnderFolder = (name, folderPath) =>
    String(name).startsWith(`${folderPath}/`);

export const buildFileTree = (fileNames = [], folderNames = []) => {
    const root = { folders: {}, files: [] };
    const ensureFolder = (segments) => {
        let node = root;
        segments.forEach((segment) => {
            if (!node.folders[segment]) {
                node.folders[segment] = { folders: {}, files: [] };
            }
            node = node.folders[segment];
        });
        return node;
    };
    folderNames.forEach((folderPath) => ensureFolder(splitPath(folderPath)));
    fileNames.forEach((fileName) => {
        const segments = splitPath(fileName);
        const baseName = segments.pop();
        if (baseName) ensureFolder(segments).files.push(fileName);
    });
    return root;
};
