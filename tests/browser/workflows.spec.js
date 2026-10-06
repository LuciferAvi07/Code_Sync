const { test, expect } = require('@playwright/test');

const password = 'browser-test-password';
const editor = (page) => page.locator('.monaco-editor .view-lines');
async function edit(page, code) {
    await editor(page).click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(code);
}
async function createFile(page, name) {
    // This helper creates a room-root path; the toolbar now follows selection.
    await page.getByRole('button', { name: 'ROOM FILES', exact: true }).focus();
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await page.getByLabel('New file name', { exact: true }).fill(name);
    await page.getByLabel('New file name', { exact: true }).press('Enter');
    await expect(page.locator('.vs-tab.active .vs-tab-label')).toHaveAttribute('title', name);
    await expect(editor(page)).toBeVisible();
}
async function account(request, name = 'Browser Tester') {
    const email = `browser-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
    const response = await request.post('/api/auth/register', { data: { name, email, password } });
    expect(response.status()).toBe(201);
    return { ...await response.json(), email };
}
async function signInWithToken(page, token, path = '/') {
    await page.goto('/login');
    await page.evaluate((value) => localStorage.setItem('code-sync-token', value), token);
    await page.goto(path);
}
async function createRoom(page, name = 'Browser room') {
    await page.getByLabel('Room name').fill(name);
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await expect(page.locator('.vs-status-left')).toContainText('1 connected');
    return page.url();
}

test('registration, sign-out, deep-link login and password-protected room', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const email = `ui-${Date.now()}@example.test`;
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel('Display name').fill('UI Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'New room' })).toBeVisible();
    await page.locator('.vscode-home-cards section').first().getByLabel('Password').fill('secret-room');
    const url = await createRoom(page, 'Private test room');
    await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await expect(page.getByText('Private test room')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.goto(url);
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('incorrect-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: 'Password protected room' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Code' })).toBeDisabled();
    await page.getByLabel('Room password', { exact: true }).fill('wrong-room');
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(page.locator('.vs-gate-error')).toContainText('Incorrect password');
    await page.getByLabel('Room password', { exact: true }).fill('secret-room');
    await page.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await page.goto('/editor/missing-room');
    await expect(page.getByRole('heading', { name: 'New room' })).toBeVisible();
    expect(errors).toEqual([]);
});

test('two browsers stay consistent through offline creation, edits, reconnect and reload', async ({ page, context, browser, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request);
    const otherUser = await account(request, 'Collaborator');
    await signInWithToken(page, user.token);
    const url = await createRoom(page);
    const peerContext = await browser.newContext();
    const peer = await peerContext.newPage();
    // Explicit base URL: this context is intentionally separate from the fixture.
    await peer.goto('http://127.0.0.1:5100/login');
    await peer.evaluate((token) => localStorage.setItem('code-sync-token', token), otherUser.token);
    await peer.goto(url);
    await expect(editor(peer)).toBeVisible();
    await expect(page.locator('.vs-status-left')).toContainText('2 connected');
    await edit(page, 'console.log("shared edit");');
    await expect(editor(peer)).toContainText('shared edit');

    await context.setOffline(true);
    await expect(page.locator('.vs-status-left')).toContainText('Offline');
    await createFile(page, 'offline.py');
    await edit(page, 'print("offline edit")');
    await context.setOffline(false);
    await expect(page.locator('.vs-status-left')).toContainText('2 connected');
    await expect(page.locator('.vs-explorer')).toContainText('offline.py');
    await expect(peer.locator('.vs-explorer')).toContainText('offline.py');
    await expect(editor(page)).toContainText('offline edit');
    await peer.locator('.vs-tree-label[title="offline.py"]').click();
    await expect(editor(peer)).toContainText('offline edit');

    await context.setOffline(true);
    await expect(page.locator('.vs-status-left')).toContainText('Offline');
    await edit(peer, 'print("updated by peer while disconnected")');
    await expect(editor(peer)).toContainText('updated by peer');
    await context.setOffline(false);
    await expect(page.locator('.vs-status-left')).toContainText('2 connected');
    await expect(editor(page)).toContainText('updated by peer');
    await page.reload();
    await page.locator('.vs-tree-label[title="offline.py"]').click();
    await expect(editor(page)).toContainText('updated by peer');
    expect(errors).toEqual([]);
    await peerContext.close();
});

test('special folder names, extensionless files, nested preview and mobile explorer', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request);
    await signInWithToken(page, user.token);
    await createRoom(page);
    await createFile(page, '__proto__/app.js');
    await edit(page, 'document.body.dataset.ready = "yes";');
    await createFile(page, 'Dockerfile');
    await page.getByRole('button', { name: 'Run Code' }).click();
    await expect(page.locator('.outputPanel')).toContainText('cannot be executed');
    await createFile(page, 'web/style.css');
    await edit(page, 'h1 { color: rgb(255, 0, 0); }');
    await createFile(page, 'web/index.html');
    await edit(page, '<link rel="stylesheet" href="./style.css"><h1>Preview works</h1><script src="../__proto__/app.js"></script>');
    await page.getByRole('button', { name: 'Run Code' }).click();
    const preview = page.frameLocator('iframe[title="web/index.html preview"]');
    await expect(preview.getByRole('heading', { name: 'Preview works' })).toHaveCSS('color', 'rgb(255, 0, 0)');
    await expect(preview.locator('body')).toHaveAttribute('data-ready', 'yes');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.getByRole('button', { name: 'Toggle explorer' }).getAttribute('aria-expanded') === 'true') {
        await page.getByRole('button', { name: 'Toggle explorer' }).click();
    }
    expect((await page.locator('.vs-editor').boundingBox()).width).toBeGreaterThan(350);
    const runBox = await page.getByRole('button', { name: 'Run Code' }).boundingBox();
    expect(runBox.x + runBox.width).toBeLessThanOrEqual(390);
    await page.getByRole('button', { name: 'Toggle explorer' }).click();
    await page.locator('.vs-tree-label[title="main.js"]').click();
    await expect(page.locator('.vs-sidebar')).not.toBeVisible();
    await page.screenshot({ path: 'test-results/mobile-editor.png' });
    await page.getByRole('button', { name: 'Rooms', exact: true }).click();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    expect(errors).toEqual([]);
});

test('execution failure status is visible and changing files cancels stale output', async ({ page, request }) => {
    const user = await account(request);
    await signInWithToken(page, user.token);
    await createRoom(page);
    await page.route('**/api/execute', (route) => route.fulfill({ json: { output: '', status: 'Time Limit Exceeded', statusId: 5 } }));
    await page.getByRole('button', { name: 'Run Code' }).click();
    await expect(page.locator('.outputPanel')).toContainText('Time Limit Exceeded');
    await page.unroute('**/api/execute');
    let release;
    const delayed = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/execute', async (route) => { await delayed; await route.fulfill({ json: { output: 'OLD FILE OUTPUT', statusId: 3 } }).catch(() => {}); });
    await page.getByRole('button', { name: 'Run Code' }).click();
    await expect(page.getByRole('button', { name: 'Running...' })).toBeDisabled();
    await createFile(page, 'second.js');
    await expect(page.getByRole('button', { name: 'Run Code' })).toBeEnabled();
    release();
    await expect(page.locator('.outputPanel')).toHaveText('Run the selected file to see its output.');
});

test('temporary API failures show retry UI without deleting the session', async ({ page, request }) => {
    const user = await account(request);
    await signInWithToken(page, user.token);
    await page.route('**/api/auth/me', (route) => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Could not connect');
    expect(await page.evaluate(() => localStorage.getItem('code-sync-token'))).toBe(user.token);
    await page.unroute('**/api/auth/me');
    await page.route('**/api/rooms', (route) => route.fulfill({ status: 503, json: { error: 'Rooms unavailable' } }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Rooms unavailable');
    await page.unroute('**/api/rooms');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('Rooms you create will show up here.')).toBeVisible();
});

async function dragBy(page, handle, dx, dy) {
    const box = await handle.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    await page.mouse.up();
}

test('panels collapse, float, drag, resize, persist and dock without losing output', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request, 'Alex Morgan');
    await signInWithToken(page, user.token);
    await createRoom(page, 'Modern workspace');
    const terminal = page.locator('[data-panel="terminal"]');
    const people = page.locator('[data-panel="people"]');
    await createFile(page, 'src/collaborate.js');
    await edit(page, '// A little better, together.\nconst workspace = {\n  name: "CodeSync",\n  connected: true,\n};\n\nfunction greet(name) {\n  return `Welcome to ${name}`;\n}\n\nconsole.log(greet(workspace.name));');
    await page.getByLabel('Program input').fill('Keep my input');
    await page.route('**/api/execute', (route) => route.fulfill({ json: { output: 'Welcome to CodeSync', statusId: 3, time: '0.02', memory: 4096 } }));
    await page.getByRole('button', { name: 'Run Code', exact: true }).click();
    await expect(page.locator('.outputPanel')).toContainText('Welcome to CodeSync');
    await expect(page.getByText('Room created', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/workbench-desktop.png' });

    const editorHeight = (await page.locator('.vs-editor').boundingBox()).height;
    await page.getByRole('button', { name: 'Collapse terminal panel', exact: true }).click();
    await expect(page.locator('.outputPanel')).not.toBeVisible();
    expect((await page.locator('.vs-editor').boundingBox()).height).toBeGreaterThan(editorHeight + 100);
    await page.keyboard.press('Control+Backquote');
    await expect(page.locator('.outputPanel')).toContainText('Welcome to CodeSync');
    await expect(page.getByLabel('Program input')).toHaveValue('Keep my input');
    await dragBy(page, page.getByRole('button', { name: 'Move terminal panel', exact: true }), 50, -220);
    await expect(terminal).toHaveClass(/is-floating/);
    const beforeResize = await terminal.boundingBox();
    await dragBy(page, page.getByRole('button', { name: 'Resize terminal panel', exact: true }), 60, 45);
    const resized = await terminal.boundingBox();
    expect(resized.width).toBeGreaterThan(beforeResize.width + 40);
    expect(resized.height).toBeGreaterThan(beforeResize.height + 20);
    await expect(page.locator('.outputPanel')).toContainText('Welcome to CodeSync');

    await page.getByRole('button', { name: 'Float people panel', exact: true }).click();
    await expect(people).toHaveClass(/is-floating/);
    const beforeMove = await people.boundingBox();
    await page.getByRole('button', { name: 'Move people panel', exact: true }).press('Shift+ArrowLeft');
    expect((await people.boundingBox()).x).toBeLessThan(beforeMove.x - 30);
    await page.getByRole('button', { name: 'Collapse people panel', exact: true }).click();
    await expect(people.locator('.vs-clients')).not.toBeVisible();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('code-sync-panel-people'))?.collapsed)).toBe(true);
    await page.reload();
    await expect(terminal).toHaveClass(/is-floating/);
    await expect(people).toHaveClass(/is-floating/);
    await expect(people).toHaveClass(/is-collapsed/);
    expect(Math.abs((await terminal.boundingBox()).width - resized.width)).toBeLessThan(3);
    await page.getByRole('button', { name: 'Expand people panel', exact: true }).click();
    await expect(people.locator('.vs-clients')).toContainText('Alex Morgan');
    await expect(editor(page)).toContainText('A little better, together.');
    await page.screenshot({ path: 'test-results/workbench-floating.png' });

    await page.getByRole('button', { name: 'Dock terminal panel', exact: true }).click();
    await expect(terminal).toHaveClass(/is-docked/);
    const dockedHeight = (await terminal.boundingBox()).height;
    await page.getByRole('separator', { name: 'Resize docked terminal' }).press('Shift+ArrowUp');
    expect((await terminal.boundingBox()).height).toBeGreaterThan(dockedHeight + 20);
    await page.getByRole('button', { name: 'Reset panel layout', exact: true }).click();
    await expect(people).toHaveClass(/is-docked/);
    await expect(people).not.toHaveClass(/is-collapsed/);
    await expect(terminal).not.toHaveClass(/is-collapsed/);
    expect(errors).toEqual([]);
});

test('mobile panels stay reachable, support cancelled drags, and run from a collapsed terminal', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request);
    await signInWithToken(page, user.token);
    await createRoom(page);
    const terminal = page.locator('[data-panel="terminal"]');
    const people = page.locator('[data-panel="people"]');
    await expect(people).not.toBeVisible();
    await page.getByRole('button', { name: 'Toggle people', exact: true }).click();
    await expect(people.locator('.vs-clients')).toContainText('Browser Tester');
    await page.getByRole('button', { name: 'Float people panel', exact: true }).click();
    await dragBy(page, page.getByRole('button', { name: 'Move people panel', exact: true }), 800, 800);
    const rect = await people.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    expect(rect.y + rect.height).toBeLessThan(844);
    const handle = await page.getByRole('button', { name: 'Move people panel', exact: true }).boundingBox();
    await page.mouse.move(handle.x + 8, handle.y + 8);
    await page.mouse.down();
    await page.mouse.move(40, 120, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(Math.abs((await people.boundingBox()).y - rect.y)).toBeLessThan(3);
    await page.getByRole('button', { name: 'Reset panel layout', exact: true }).click();
    await expect(people).not.toBeVisible();
    await page.getByRole('button', { name: 'Collapse terminal panel', exact: true }).click();
    await page.route('**/api/execute', (route) => route.fulfill({ json: { output: 'Mobile run works', statusId: 3 } }));
    await page.getByRole('button', { name: 'Run file', exact: true }).click();
    await expect(terminal).not.toHaveClass(/is-collapsed/);
    await expect(page.locator('.outputPanel')).toContainText('Mobile run works');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(page.getByText('Workspace layout reset', { exact: true })).not.toBeVisible();
    await page.screenshot({ path: 'test-results/workbench-mobile.png' });
    expect(errors).toEqual([]);
});

test('Explorer creates inline at the selection, validates names, and supports Enter, Escape and blur', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request);
    await signInWithToken(page, user.token);
    await createRoom(page);
    const input = page.getByLabel('New file name', { exact: true });
    const folderInput = page.getByLabel('New folder name', { exact: true });
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    await expect(folderInput).toBeFocused();
    await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', '');
    await folderInput.fill('src');
    await folderInput.press('Enter');
    const src = page.locator('[data-explorer-path="src"]');
    await expect(src).toBeFocused();
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', 'src');
    await expect(page.locator('[data-folder-path="src"] input')).toBeVisible();
    await expect(input).toHaveValue('');
    await input.fill('app.js');
    await input.press('Enter');
    await expect(page.locator('.vs-tab.active .vs-tab-label')).toHaveAttribute('title', 'src/app.js');
    await expect(page.locator('[data-explorer-path="src/app.js"]')).toHaveCount(1);

    // A selected file targets its containing directory, not the room root.
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', 'src');
    await input.fill('app.js');
    await input.press('Enter');
    await expect(page.locator('.vs-inline-create [role="alert"]')).toContainText('already exists');
    await expect(input).toBeFocused();
    await input.fill('../outside.js');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.vs-inline-create [role="alert"]')).toContainText('not allowed');
    await input.fill('.env');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await input.press('Tab');
    await expect(page.locator('[data-explorer-path="src/.env"]')).toHaveCount(1);
    await expect(input).not.toBeVisible();

    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await input.fill('cancelled.js');
    await input.press('Escape');
    await expect(input).not.toBeVisible();
    await expect(src).toBeFocused();
    await expect(page.locator('[data-explorer-path="src/cancelled.js"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await input.press('Tab');
    await expect(input).not.toBeVisible();

    // Starting inside a collapsed folder expands it and focuses the inline row.
    await src.click();
    await expect(src).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await expect(src).toHaveAttribute('aria-expanded', 'true');
    await input.fill('utils/format.js');
    await page.screenshot({ path: 'test-results/explorer-inline-create.png' });
    await input.press('Enter');
    await expect(page.locator('[data-explorer-path="src/utils/format.js"]')).toBeVisible();
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expect(page.locator('[data-explorer-path="src/utils/format.js"]')).toBeVisible();
    expect(errors).toEqual([]);
});

test('Explorer context menus create nested folders and root files with keyboard and mobile controls', async ({ page, request }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const user = await account(request);
    await signInWithToken(page, user.token);
    await createRoom(page);
    await page.locator('[data-explorer-path="main.js"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Folder…', exact: true }).click();
    await page.getByLabel('New folder name', { exact: true }).fill('v1.0');
    await page.getByLabel('New folder name', { exact: true }).press('Enter');
    const folder = page.locator('[data-explorer-path="v1.0"]');
    await folder.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Explorer actions' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', 'v1.0');
    await page.getByLabel('New folder name', { exact: true }).fill('docs/api');
    await page.getByLabel('New folder name', { exact: true }).press('Enter');
    await expect(page.locator('[data-explorer-path="v1.0/docs/api"]')).toBeVisible();
    await folder.click({ button: 'right' });
    await page.screenshot({ path: 'test-results/explorer-context-menu.png' });
    await page.keyboard.press('Escape');
    await expect(folder).toBeFocused();

    // Folder inline actions are available without a right-click on mobile.
    await page.setViewportSize({ width: 390, height: 844 });
    await folder.hover();
    await page.getByRole('button', { name: 'New folder in v1.0', exact: true }).click();
    await page.getByLabel('New folder name', { exact: true }).fill('docs');
    await page.getByLabel('New folder name', { exact: true }).press('Enter');
    await expect(page.locator('.vs-inline-create [role="alert"]')).toContainText('folder with this name');
    await page.getByLabel('New folder name', { exact: true }).press('Escape');
    await page.getByRole('button', { name: 'ROOM FILES', exact: true }).click();
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', '');
    await page.getByLabel('New file name', { exact: true }).fill('Dockerfile');
    await page.getByLabel('New file name', { exact: true }).press('Enter');
    await expect(page.locator('.vs-tab.active .vs-tab-label')).toHaveAttribute('title', 'Dockerfile');
    await expect(page.locator('.vs-sidebar')).not.toBeVisible();
    expect(errors).toEqual([]);
});

test('inline creation handles collaborator changes to its destination folder', async ({ page, browser, request }) => {
    const user = await account(request);
    await signInWithToken(page, user.token);
    const url = await createRoom(page);
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    await page.getByLabel('New folder name', { exact: true }).fill('shared');
    await page.getByLabel('New folder name', { exact: true }).press('Enter');
    const peerContext = await browser.newContext();
    try {
        const peer = await peerContext.newPage();
        await peer.goto('http://127.0.0.1:5100/login');
        await peer.evaluate((token) => localStorage.setItem('code-sync-token', token), user.token);
        await peer.goto(url);
        await expect(editor(peer)).toBeVisible();
        await page.getByRole('button', { name: 'New file', exact: true }).click();
        await page.getByLabel('New file name', { exact: true }).fill('draft.js');
        await expect(page.locator('.vs-inline-create')).toHaveAttribute('data-parent-path', 'shared');
        await peer.locator('[data-explorer-path="shared"]').hover();
        peer.once('dialog', (dialog) => dialog.accept());
        await peer.getByRole('button', { name: 'Delete shared', exact: true }).click();
        await expect(page.getByLabel('New file name', { exact: true })).not.toBeVisible();
        await expect(page.getByText('The destination folder was removed. Choose another folder.')).toBeVisible();
        await createFile(page, 'shared.js');
        await expect(peer.locator('[data-explorer-path="shared.js"]')).toBeVisible();
        await expect(peer.locator('[data-explorer-path="shared/draft.js"]')).toHaveCount(0);
    } finally {
        await peerContext.close();
    }
});
