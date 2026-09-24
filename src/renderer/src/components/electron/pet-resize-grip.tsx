import { useRef, useState } from 'react';
import { useMode } from '@/context/mode-context';
import { usePetFullscreen } from '@/hooks/utils/use-pet-fullscreen';

/**
 * Bottom-right corner grip that resizes the compact pet window.
 * (Transparent frameless windows can't use native edge-resizing on Windows.)
 */
export function PetResizeGrip(): JSX.Element | null {
  const { mode } = useMode();
  const petFullscreen = usePetFullscreen();
  const ipc = (window as any).electron?.ipcRenderer;
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(false);

  if (mode !== 'pet' || petFullscreen || !ipc) return null;

  return (
    <div
      title="Drag to resize"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        last.current = { x: e.screenX, y: e.screenY };
      }}
      onPointerMove={(e) => {
        if (!last.current) return;
        ipc.send('pet-window-resize-drag', e.screenX - last.current.x, e.screenY - last.current.y);
        last.current = { x: e.screenX, y: e.screenY };
      }}
      onPointerUp={(e) => {
        last.current = null;
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        position: 'fixed',
        right: 2,
        bottom: 2,
        width: 18,
        height: 18,
        zIndex: 2000,
        cursor: 'nwse-resize',
        opacity: hover || last.current ? 0.9 : 0.35,
        transition: 'opacity 0.15s',
        background:
          'linear-gradient(135deg, transparent 0 55%, rgba(255,255,255,0.9) 55% 62%, transparent 62% 72%, rgba(255,255,255,0.9) 72% 79%, transparent 79%)',
        borderRadius: 3,
      }}
    />
  );
}
