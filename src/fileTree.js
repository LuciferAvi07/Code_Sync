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

// Resolve an Explorer name relative to its selected parent. Both explicit and
// inferred folders count as existing entries when checking path conflicts.
export const validateNewEntry = ({ name, parent = '', kind }, fileNames, folderNames) => {
    const relativePath = normalizePath(name);
    if (!relativePath) return { error: `Enter a ${kind} name.` };
    const path = parent ? `${parent}/${relativePath}` : relativePath;
    const segments = splitPath(path);
    if (hasTraversalSegments(segments)) return { error: 'Names "." and ".." are not allowed.' };
    if (path.length > 200 || /[\u0000-\u001f\u007f]/.test(path)) {
        return { error: 'Paths must be at most 200 characters without control characters.' };
    }
    if (fileNames.includes(path)) return { error: 'A file with this name already exists.' };
    if (folderNames.includes(path)) return { error: 'A folder with this name already exists.' };
    const folders = ancestorPaths(segments, kind === 'folder');
    const conflict = folders.find((folder) => fileNames.includes(folder));
    if (conflict) return { error: `"${conflict}" is a file, so it cannot contain other items.` };
    return { path, folders };
};

export const buildFileTree = (fileNames = [], folderNames = []) => {
    const root = { folders: Object.create(null), files: [] };
    const ensureFolder = (segments) => {
        let node = root;
        segments.forEach((segment) => {
            if (!node.folders[segment]) {
                node.folders[segment] = { folders: Object.create(null), files: [] };
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
