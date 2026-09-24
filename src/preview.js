const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeForTag = (value, tagName) =>
    String(value || '').replace(new RegExp(`</${tagName}`, 'gi'), `<\\/${tagName}`);

const injectBeforeCloseTag = (html, tagName, fragment) => {
    const pattern = new RegExp(`</${tagName}\\s*>`, 'i');
    if (!pattern.test(html)) return null;
    return html.replace(pattern, (match) => `${fragment}\n${match}`);
};

const injectIntoOpeningTag = (html, tagName, fragment) => {
    const pattern = new RegExp(`<${tagName}(\\s[^>]*)?>`, 'i');
    if (!pattern.test(html)) return null;
    return html.replace(pattern, (match) => `${match}\n${fragment}`);
};

const stripLocalReferences = (html, cssNames, jsNames) => {
    let result = html;
    if (cssNames.length) {
        const names = cssNames.map(escapeRegExp).join('|');
        result = result.replace(
            new RegExp(
                `<link\\b[^>]*href=["'](?:\\.\\/)?(?:${names})(?:[?#][^"']*)?["'][^>]*>`,
                'gi'
            ),
            ''
        );
    }
    if (jsNames.length) {
        const names = jsNames.map(escapeRegExp).join('|');
        result = result.replace(
            new RegExp(
                `<script\\b[^>]*src=["'](?:\\.\\/)?(?:${names})(?:[?#][^"']*)?["'][^>]*>\\s*<\\/script>`,
                'gi'
            ),
            ''
        );
    }
    return result;
};

const buildHtmlPreview = (activeFile, files) => {
    const otherFiles = (files || []).filter(
        (file) => file && file.name && file.name !== activeFile.name
    );
    const cssFiles = otherFiles.filter((file) => /\.css$/i.test(file.name));
    const jsFiles = otherFiles.filter((file) => /\.jsx?$/i.test(file.name));

    let html = stripLocalReferences(
        String(activeFile.content || ''),
        cssFiles.map((file) => file.name),
        jsFiles.map((file) => file.name)
    );

    if (cssFiles.length) {
        const styles = cssFiles
            .map(
                (file) =>
                    `<style data-preview-file="${file.name}">\n${escapeForTag(
                        file.content,
                        'style'
                    )}\n</style>`
            )
            .join('\n');
        html =
            injectBeforeCloseTag(html, 'head', styles) ||
            injectIntoOpeningTag(html, 'body', styles) ||
            injectIntoOpeningTag(html, 'html', styles) ||
            `${styles}\n${html}`;
    }

    if (jsFiles.length) {
        const scripts = jsFiles
            .map(
                (file) =>
                    `<script data-preview-file="${file.name}">\n${escapeForTag(
                        file.content,
                        'script'
                    )}\n</script>`
            )
            .join('\n');
        html = injectBeforeCloseTag(html, 'body', scripts) || `${html}\n${scripts}`;
    }

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
