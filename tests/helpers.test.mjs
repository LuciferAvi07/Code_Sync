import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFileTree, validateNewEntry } from '../src/fileTree.js';
import { replayRoomChanges } from '../src/roomState.js';
import { buildPreviewDocument } from '../src/preview.js';

test('explorer supports folder names inherited by ordinary objects', () => {
    const tree = buildFileTree(['__proto__/test.js', 'constructor/app.py', 'toString/index.html']);
    assert.deepEqual(Object.keys(tree.folders).sort(), ['__proto__', 'constructor', 'toString']);
    assert.deepEqual(tree.folders.__proto__.files, ['__proto__/test.js']);
    assert.equal(Object.prototype.files, undefined);
});

test('inline creation resolves relative paths and rejects conflicting or invalid names', () => {
    const files = ['main.js', 'src/app.js'];
    const folders = ['src', 'src/components'];
    assert.deepEqual(validateNewEntry({ kind: 'file', parent: 'src', name: 'utils/format.js' }, files, folders), {
        path: 'src/utils/format.js', folders: ['src', 'src/utils'],
    });
    assert.equal(validateNewEntry({ kind: 'file', parent: 'src', name: '.env' }, files, folders).path, 'src/.env');
    assert.equal(validateNewEntry({ kind: 'file', parent: '', name: 'Dockerfile' }, files, folders).path, 'Dockerfile');
    for (const name of ['', '..', '../outside.js', 'app.js', 'components', 'app.js/child', 'x'.repeat(198), 'bad\u0000name']) {
        assert.ok(validateNewEntry({ kind: 'file', parent: 'src', name }, files, folders).error, name);
    }
});

test('offline replay keeps created files, text and ordered deletes visible locally', () => {
    const state = replayRoomChanges({ files: [{ path: 'main.js', content: 'original' }], folders: [] }, [
        ['file-created', { path: 'src/offline.py', content: '' }],
        ['code-change', { path: 'src/offline.py', code: 'print(42)' }],
        ['file-created', { path: 'removed.js', content: '' }],
        ['code-change', { path: 'removed.js', code: 'obsolete' }],
        ['file-deleted', { path: 'removed.js' }],
        ['code-change', { path: 'deleted-by-peer.js', code: 'must not resurrect' }],
    ]);
    assert.deepEqual(state.files.map((file) => file.name), ['main.js', 'src/offline.py']);
    assert.equal(state.files[1].content, 'print(42)');
    assert.deepEqual(state.folders, ['src']);
});

test('preview resolves nested references, preserves script order, and skips unrelated programs', () => {
    const html = buildPreviewDocument('web/index.html', [
        { name: 'web/style.css', content: 'body { color: red; }' },
        { name: 'scripts/app.js', content: 'document.body.dataset.ready = "yes";' },
        { name: 'main.js', content: 'throw new Error("unrelated")' },
    ], '<link rel="stylesheet" href="./style.css?v=1"><body><p>Preview</p><script src="../scripts/app.js"></script></body>');
    assert.match(html, /body \{ color: red; \}/);
    assert.match(html, /dataset.ready/);
    assert.doesNotMatch(html, /href=|src=|unrelated/);
    assert.ok(html.indexOf('<p>Preview</p>') < html.indexOf('dataset.ready'));
});
