import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker&inline';
import TypeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker';
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';

// Include the supported grammars in the editor bundle, so switching to a new
// language during a temporary disconnect does not need another network request.
const grammars = import.meta.glob('/node_modules/monaco-editor/esm/vs/languages/definitions/{javascript,typescript,python,java,cpp,csharp,go,rust,ruby,php,kotlin,swift,sql,html,css}/*.js', { eager: true });
for (const [path, grammar] of Object.entries(grammars)) {
    if (!grammar.language) continue;
    const id = path.split('/').at(-2);
    monaco.languages.setMonarchTokensProvider(id, grammar.language);
    monaco.languages.setLanguageConfiguration(id, grammar.conf);
}

self.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === 'typescript' || label === 'javascript') return new TypeScriptWorker();
        if (label === 'html') return new HtmlWorker();
        if (label === 'css') return new CssWorker();
        if (label === 'json') return new JsonWorker();
        return new EditorWorker();
    },
};
loader.config({ monaco });
