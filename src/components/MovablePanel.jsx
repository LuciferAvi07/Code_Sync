import React, { useCallback, useEffect, useRef, useState } from 'react';
import WorkbenchIcon from './WorkbenchIcon';

const HEADER_HEIGHT = 44;
const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));

export default function MovablePanel({ id, title, icon, badge, dock, layout, onLayoutChange, boundsRef, active, onActivate, children }) {
    const panelRef = useRef(null);
    const gestureRef = useRef(null);
    const [interacting, setInteracting] = useState(false);
    const contentId = `${id}-panel-content`;
    const titleId = `${id}-panel-title`;

    const fit = useCallback((next) => {
        const bounds = boundsRef.current?.getBoundingClientRect();
        if (!bounds) return next;
        const maxWidth = Math.max(160, bounds.width - 16);
        const maxHeight = Math.max(HEADER_HEIGHT, bounds.height - 16);
        const width = clamp(next.width, Math.min(260, maxWidth), maxWidth);
        const height = clamp(next.height, Math.min(180, maxHeight), maxHeight);
        return {
            ...next,
            width,
            height,
            x: clamp(next.x, bounds.left + 8, bounds.right - width - 8),
            y: clamp(next.y, bounds.top + 8, bounds.bottom - (next.collapsed ? HEADER_HEIGHT : height) - 8),
            dockSize: dock === 'bottom'
                ? clamp(next.dockSize, Math.min(180, maxHeight), Math.max(180, bounds.height - 180))
                : clamp(next.dockSize, 220, Math.max(220, Math.min(380, bounds.width * .35))),
        };
    }, [boundsRef, dock]);

    useEffect(() => {
        onLayoutChange((current) => fit(current));
    }, [layout.collapsed, layout.floating, fit, onLayoutChange]);

    useEffect(() => {
        const resize = () => onLayoutChange((current) => {
            const next = fit(current);
            return Object.keys(next).some((key) => next[key] !== current[key]) ? next : current;
        });
        resize();
        const observer = new ResizeObserver(resize);
        if (boundsRef.current) observer.observe(boundsRef.current);
        window.addEventListener('resize', resize);
        return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
    }, [boundsRef, fit, onLayoutChange]);

    const finish = useCallback((cancel = false) => {
        const gesture = gestureRef.current;
        if (!gesture) return;
        gestureRef.current = null;
        if (cancel) onLayoutChange(gesture.original);
        if (gesture.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
        document.body.classList.remove('vs-panel-interacting');
        setInteracting(false);
    }, [onLayoutChange]);

    useEffect(() => {
        const cancel = (event) => { if (event.key === 'Escape') finish(true); };
        window.addEventListener('keydown', cancel);
        return () => {
            window.removeEventListener('keydown', cancel);
            if (gestureRef.current) document.body.classList.remove('vs-panel-interacting');
        };
    }, [finish]);

    const floatingRect = () => {
        const rect = panelRef.current.getBoundingClientRect();
        return fit({ ...layout, floating: true, x: rect.left + 24, y: rect.top + 8 });
    };

    const start = (event, kind) => {
        if (event.button !== 0 || event.target.closest('[data-panel-control]')) return;
        event.preventDefault();
        onActivate();
        const rect = panelRef.current.getBoundingClientRect();
        const base = layout.floating ? layout : fit({
            ...layout,
            floating: true,
            x: event.clientX - ((event.clientX - rect.left) / rect.width) * layout.width,
            y: rect.top,
        });
        gestureRef.current = {
            kind, base, original: layout, x: event.clientX, y: event.clientY,
            pointerId: event.pointerId, target: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const move = (event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const dx = event.clientX - gesture.x;
        const dy = event.clientY - gesture.y;
        if (!interacting && Math.hypot(dx, dy) < 4) return;
        setInteracting(true);
        document.body.classList.add('vs-panel-interacting');
        if (gesture.kind === 'move') {
            onLayoutChange(fit({ ...gesture.base, x: gesture.base.x + dx, y: gesture.base.y + dy }));
        } else if (gesture.kind === 'resize') {
            const bounds = boundsRef.current.getBoundingClientRect();
            onLayoutChange(fit({
                ...gesture.base,
                width: Math.min(gesture.base.width + dx, bounds.right - gesture.base.x - 8),
                height: Math.min(gesture.base.height + dy, bounds.bottom - gesture.base.y - 8),
            }));
        } else {
            onLayoutChange(fit({ ...gesture.original, dockSize: gesture.original.dockSize - (dock === 'bottom' ? dy : dx) }));
        }
    };

    const keyboardAdjust = (event, kind) => {
        const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if (!direction) return;
        event.preventDefault();
        onActivate();
        const step = event.shiftKey ? 40 : 10;
        const [dx, dy] = direction.map((value) => value * step);
        if (kind === 'move') {
            const base = layout.floating ? layout : floatingRect();
            onLayoutChange(fit({ ...base, x: base.x + dx, y: base.y + dy }));
        } else if (kind === 'resize') {
            onLayoutChange(fit({ ...layout, width: layout.width + dx, height: layout.height + dy }));
        } else {
            onLayoutChange(fit({ ...layout, dockSize: layout.dockSize - (dock === 'bottom' ? dy : dx) }));
        }
    };

    const pointerHandlers = {
        onPointerMove: move,
        onPointerUp: () => finish(),
        onPointerCancel: () => finish(true),
        onLostPointerCapture: () => finish(),
    };
    const style = layout.floating
        ? { left: layout.x, top: layout.y, width: layout.width, height: layout.collapsed ? HEADER_HEIGHT : layout.height, zIndex: active ? 60 : 50 }
        : { '--panel-dock-size': `${layout.dockSize}px` };

    return (
        <section
            ref={panelRef}
            className={`vs-widget vs-widget--${dock}${layout.floating ? ' is-floating' : ' is-docked'}${layout.collapsed ? ' is-collapsed' : ''}${interacting ? ' is-interacting' : ''}`}
            data-panel={id}
            aria-labelledby={titleId}
            style={style}
            onPointerDownCapture={onActivate}
            onFocusCapture={onActivate}
        >
            {!layout.floating && !layout.collapsed && (
                <div
                    className="vs-widget-dock-resize"
                    role="separator"
                    tabIndex={0}
                    aria-label={`Resize docked ${title.toLowerCase()}`}
                    aria-orientation={dock === 'bottom' ? 'horizontal' : 'vertical'}
                    aria-valuenow={Math.round(layout.dockSize)}
                    onPointerDown={(event) => start(event, 'dock-resize')}
                    onKeyDown={(event) => keyboardAdjust(event, 'dock-resize')}
                    {...pointerHandlers}
                />
            )}
            <header className="vs-widget-header" onPointerDown={(event) => start(event, 'move')} {...pointerHandlers}>
                <button
                    className="vs-widget-grip"
                    aria-label={`Move ${title.toLowerCase()} panel`}
                    title="Drag to move · Arrow keys to reposition · Escape to cancel"
                    onKeyDown={(event) => keyboardAdjust(event, 'move')}
                    onClick={(event) => { if (event.detail === 0) onLayoutChange(floatingRect()); }}
                >
                    <WorkbenchIcon name="grip" />
                </button>
                <span className="vs-widget-title" id={titleId}>
                    <WorkbenchIcon name={icon} />
                    <span>{title}</span>
                    {badge != null && <span className="vs-widget-badge">{badge}</span>}
                </span>
                <div className="vs-widget-actions" data-panel-control>
                    <button
                        className="vs-icon-button"
                        aria-label={`${layout.floating ? 'Dock' : 'Float'} ${title.toLowerCase()} panel`}
                        title={layout.floating ? 'Return to dock' : 'Float panel'}
                        onClick={() => onLayoutChange(layout.floating ? { ...layout, floating: false } : floatingRect())}
                    >
                        <WorkbenchIcon name={layout.floating ? 'dock' : 'float'} size={14} />
                    </button>
                    <button
                        className="vs-icon-button"
                        aria-label={`${layout.collapsed ? 'Expand' : 'Collapse'} ${title.toLowerCase()} panel`}
                        aria-expanded={!layout.collapsed}
                        aria-controls={contentId}
                        title={layout.collapsed ? 'Expand panel' : 'Collapse panel'}
                        onClick={() => onLayoutChange(fit({ ...layout, collapsed: !layout.collapsed }))}
                    >
                        <WorkbenchIcon name={layout.collapsed ? 'expand' : 'collapse'} />
                    </button>
                </div>
            </header>
            <div className="vs-widget-content" id={contentId} hidden={layout.collapsed}>
                {children}
            </div>
            {layout.floating && !layout.collapsed && (
                <button
                    className="vs-widget-resize"
                    aria-label={`Resize ${title.toLowerCase()} panel`}
                    title="Drag to resize · Arrow keys to resize"
                    onPointerDown={(event) => start(event, 'resize')}
                    onKeyDown={(event) => keyboardAdjust(event, 'resize')}
                    {...pointerHandlers}
                >
                    <WorkbenchIcon name="resize" size={15} />
                </button>
            )}
        </section>
    );
}
