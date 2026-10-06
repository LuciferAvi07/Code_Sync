import React from 'react';

const paths = {
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    'new-file': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 12v6 M9 15h6',
    'new-folder': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 11v6 M9 14h6',
    chevron: 'M9 6l6 6-6 6',
    terminal: 'M4 4h16v16H4z M7 8l3 3-3 3 M13 15h4',
    people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    float: 'M14 3h7v7 M21 3l-9 9 M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5',
    dock: 'M4 4h16v16H4z M4 14h16',
    collapse: 'M6 9l6 6 6-6',
    expand: 'M6 15l6-6 6 6',
    reset: 'M3 10a9 9 0 1 1 2 8 M3 3v7h7',
    play: 'M7 4l14 8-14 8z',
    code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',
    link: 'M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2',
    resize: 'M20 8L8 20 M20 14l-6 6 M20 20h.01',
};

export default function WorkbenchIcon({ name, size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {name === 'grip' ? [7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r=".8" />)) : <path d={paths[name]} />}
        </svg>
    );
}
