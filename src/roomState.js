import ACTIONS from './Actions.json' with { type: 'json' };
import { ancestorPaths, isUnderFolder, splitPath } from './fileTree.js';

export { ACTIONS };

// Rebase disconnected edits onto a fresh server snapshot in their original
// order. The server excludes the sender from broadcasts, so replaying only on
// the wire would leave the author's explorer showing the old snapshot.
export function replayRoomChanges(snapshot, changes) {
    let files = snapshot.files.map(({ path, content = '' }) => ({ name: path, content, savedContent: content }));
    let folders = [...(snapshot.folders || [])];
    for (const [event, payload] of changes) {
        const { path, content = '', code } = payload;
        if (event === ACTIONS.FILE_CREATED && !files.some((file) => file.name === path)) {
            files.push({ name: path, content, savedContent: content });
            folders.push(...ancestorPaths(splitPath(path)));
        } else if (event === ACTIONS.CODE_CHANGE) {
            files = files.map((file) => file.name === path ? { ...file, content: code } : file);
        } else if (event === ACTIONS.FILE_DELETED) {
            const remaining = files.filter((file) => file.name !== path);
            if (remaining.length) files = remaining;
        } else if (event === ACTIONS.FOLDER_CREATED) {
            folders.push(...ancestorPaths(splitPath(path), true));
        } else if (event === ACTIONS.FOLDER_DELETED) {
            const remaining = files.filter((file) => !isUnderFolder(file.name, path));
            if (remaining.length) {
                files = remaining;
                folders = folders.filter((folder) => folder !== path && !isUnderFolder(folder, path));
            }
        }
    }
    return { files, folders: [...new Set(folders)] };
}
