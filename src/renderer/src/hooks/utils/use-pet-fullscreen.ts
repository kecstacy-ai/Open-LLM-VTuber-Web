import { useEffect, useState } from 'react';

/**
 * Pet-mode window size setting from the Electron main process.
 * true  = transparent window spans all displays (upstream behaviour)
 * false = compact floating window; dragging the character moves the window itself
 */
export function usePetFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const ipc = (window as any).electron?.ipcRenderer;
    if (!ipc) return undefined;
    ipc.invoke('get-pet-fullscreen').then((v: boolean) => setFullscreen(!!v)).catch(() => {});
    const remove = ipc.on('pet-fullscreen-changed', (_e: unknown, v: boolean) => setFullscreen(!!v));
    return () => { if (typeof remove === 'function') remove(); };
  }, []);

  return fullscreen;
}

/** Move the compact pet window by a screen-pixel delta. */
export function movePetWindowBy(dx: number, dy: number): void {
  (window as any).electron?.ipcRenderer?.send('pet-window-move-by', dx, dy);
}

/** Scale the compact pet window (bottom-centre anchored). */
export function resizePetWindowBy(factor: number): void {
  (window as any).electron?.ipcRenderer?.send('pet-window-resize-by', factor);
}
