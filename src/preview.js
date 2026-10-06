const escapeForTag = (value, tagName) =>
    String(value || '').replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);

const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const resolveReference = (fileName, reference) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return null;
    const parts = reference.startsWith('/') ? [] : fileName.split('/').slice(0, -1);
    for (const part of reference.split(/[?#]/)[0].split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return parts.join('/');
};

const buildHtmlPreview = (activeFile, files) => {
    const byPath = new Map(files.filter(Boolean).map((file) => [file.name, file]));
    const getFile = (reference) => byPath.get(resolveReference(activeFile.name, reference));
    // Inline only referenced assets, in document order. Injecting every JS/CSS
    // file ran unrelated programs and broke pages in nested directories.
    let html = String(activeFile.content || '').replace(
        /<link\b[^>]*>/gi,
        (tag) => {
            if (!/\brel\s*=\s*["']stylesheet["']/i.test(tag)) return tag;
            const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
            const file = href && getFile(href);
            if (!file) return tag;
            const media = tag.match(/\bmedia\s*=\s*["']([^"']*)["']/i)?.[1];
            return `<style data-preview-file="${escapeAttribute(file.name)}"${media ? ` media="${escapeAttribute(media)}"` : ''}>\n${escapeForTag(file.content, 'style')}\n</style>`;
        }
    ).replace(
        /<script\b([^>]*)>\s*<\/script\s*>/gi,
        (tag, attributes) => {
            const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
            const file = src && getFile(src);
            if (!file) return tag;
            const rest = attributes.replace(/\bsrc\s*=\s*["'][^"']+["']/i, '');
            return `<script${rest} data-preview-file="${escapeAttribute(file.name)}">\n${escapeForTag(file.content, 'script')}\n</script>`;
        }
    );

    if (!/<!doctype\s+html/i.test(html)) {
        html = `<!DOCTYPE html>\n${html}`;
    }
    return html;
};

const buildCssPreview = (css) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CSS preview</title>
<style>
${escapeForTag(css, 'style')}
</style>
</head>
<body>
<div class="container">
    <header class="header">
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3 class="title">Heading 3</h3>
    </header>
    <p class="text">This sample paragraph shows element selectors and class selectors such as <code>.text</code>.</p>
    <a href="#" class="link">Sample link</a>
    <div class="card">
        <p class="content">Sample card content.</p>
        <button class="btn" type="button">Sample button</button>
        <input class="input" type="text" placeholder="Sample input" />
    </div>
    <ul class="list">
        <li>Sample list item 1</li>
        <li>Sample list item 2</li>
    </ul>
    <div class="image">.image</div>
</div>
</body>
</html>
`;

export const buildPreviewDocument = (fileName, files = [], activeCode = '') => {
    if (/\.html?$/i.test(fileName)) {
        return buildHtmlPreview({ name: fileName, content: activeCode }, files);
    }
    return buildCssPreview(activeCode);
};
