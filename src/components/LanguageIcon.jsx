import React from 'react';
import { getLanguageForFile } from '../languages';

export default function LanguageIcon({ fileName }) {
    const label = getLanguageForFile(fileName).label;
    const badges = {
        JavaScript: ['JS', '#f7df1e'], TypeScript: ['TS', '#54a5ef'],
        Python: ['Py', '#ffd343'], HTML: ['<>', '#e8794b'], CSS: ['#', '#54a5ef'],
        'C++': ['C+', '#54a5ef'], 'C#': ['C#', '#af81d2'], 'Plain text': ['≡', '#aaa'],
    };
    const [text, color] = badges[label] || [label.slice(0, 2), '#9cdcfe'];
    return (
        <span className="vs-lang-icon" title={label} aria-hidden="true">
            <span className="vs-lang-badge" style={{ color }}>{text}</span>
        </span>
    );
}
