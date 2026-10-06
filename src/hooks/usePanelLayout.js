import { useEffect, useRef, useState } from 'react';

const saveLayout = (key, layout) => {
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* Optional preference. */ }
};

export default function usePanelLayout(id, initialLayout) {
    const defaults = useRef(initialLayout);
    const storageKey = `code-sync-panel-${id}`;
    const [layout, setLayout] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            if (!saved) return initialLayout;
            const restored = { ...initialLayout };
            for (const key of ['x', 'y', 'width', 'height', 'dockSize']) {
                if (Number.isFinite(saved[key])) restored[key] = saved[key];
            }
            for (const key of ['floating', 'collapsed']) {
                if (typeof saved[key] === 'boolean') restored[key] = saved[key];
            }
            return restored;
        } catch {
            return initialLayout;
        }
    });
    const latest = useRef(layout);
    latest.current = layout;

    useEffect(() => {
        const timer = setTimeout(() => saveLayout(storageKey, latest.current), 200);
        return () => clearTimeout(timer);
    }, [layout, storageKey]);

    useEffect(() => {
        const save = () => saveLayout(storageKey, latest.current);
        window.addEventListener('pagehide', save);
        return () => {
            window.removeEventListener('pagehide', save);
            save();
        };
    }, [storageKey]);

    return [layout, setLayout, () => setLayout({ ...defaults.current })];
}
