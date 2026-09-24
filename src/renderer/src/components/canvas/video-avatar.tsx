/* eslint-disable no-console */
/**
 * Video avatar: a realistic character made of pre-rendered, transparent (VP9 alpha WebM) clips.
 * Picks idle / listening / thinking / talking clips from AI state + audio playback,
 * crossfades between two <video> layers, supports drag, wheel resize and pet-mode click-through.
 */
import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useLive2DConfig, VideoClipSet } from '@/context/live2d-config-context';
import { useAiState, AiStateEnum } from '@/context/ai-state-context';
import { useMode } from '@/context/mode-context';
import { useIpcHandlers } from '@/hooks/utils/use-ipc-handlers';
import { useInterrupt } from '@/hooks/utils/use-interrupt';
import { useAudioTask } from '@/hooks/utils/use-audio-task';
import { useForceIgnoreMouse } from '@/hooks/utils/use-force-ignore-mouse';
import { audioManager, SpeakingState } from '@/utils/audio-manager';
import { usePetFullscreen, movePetWindowBy, resizePetWindowBy } from '@/hooks/utils/use-pet-fullscreen';

type ClipState = 'idle' | 'listening' | 'thinking' | 'talking';

const TALK_HOLD_MS = 450; // keep talking clip across short gaps between sentences
const HOVER_ID = 'live2d-model'; // reuse the id the Electron main process already tracks
const STORE_KEY = 'videoAvatarLayout';

interface Layout { x: number; y: number; scale: number }

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { x: 0, y: 0, scale: 1, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return { x: 0, y: 0, scale: 1 };
}

function saveLayout(l: Layout) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

function pick(list: string[] | undefined, avoid?: string): string | undefined {
  if (!list || list.length === 0) return undefined;
  if (list.length === 1) return list[0];
  const options = list.filter((c) => c !== avoid);
  return options[Math.floor(Math.random() * options.length)];
}

function clipsFor(state: ClipState, clips: VideoClipSet, expression: string | number | null): string[] {
  if (state === 'talking') {
    const byEmotion = expression !== null ? clips.talkingByEmotion?.[String(expression)] : undefined;
    return byEmotion?.length ? byEmotion : (clips.talking?.length ? clips.talking : clips.idle);
  }
  if (state === 'listening') return clips.listening?.length ? clips.listening : clips.idle;
  if (state === 'thinking') return clips.thinking?.length ? clips.thinking : clips.idle;
  return clips.idle;
}

export const VideoAvatar = memo((): JSX.Element => {
  const { modelInfo } = useLive2DConfig();
  const { aiState } = useAiState();
  const { mode } = useMode();
  const { forceIgnoreMouse } = useForceIgnoreMouse();
  const isPet = mode === 'pet';
  const electronApi = (window as any).electron;

  // Same side-effect hooks the Live2D canvas runs (IPC, interrupt, audio queue)
  useIpcHandlers();
  useInterrupt();
  useAudioTask();

  const clips = modelInfo?.videoClips;
  const crossfadeMs = modelInfo?.videoCrossfadeMs ?? 250;
  const baseUrl = modelInfo?.url ?? '';

  // ---------- speaking state (debounced across sentence gaps) ----------
  const [speech, setSpeech] = useState<SpeakingState>(audioManager.getSpeakingState());
  useEffect(() => {
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = audioManager.subscribeSpeaking((s) => {
      if (s.speaking) {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        setSpeech(s);
      } else {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = setTimeout(() => setSpeech(s), TALK_HOLD_MS);
      }
    });
    return () => { unsub(); if (holdTimer) clearTimeout(holdTimer); };
  }, []);

  const clipState: ClipState = useMemo(() => {
    if (speech.speaking) return 'talking';
    if (aiState === AiStateEnum.LISTENING) return 'listening';
    if (aiState === AiStateEnum.THINKING_SPEAKING || aiState === AiStateEnum.LOADING) return 'thinking';
    return 'idle';
  }, [speech.speaking, aiState]);

  const resolve = useCallback((clip: string) => {
    try { return new URL(clip, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString(); } catch { return clip; }
  }, [baseUrl]);

  // ---------- two-layer crossfade player ----------
  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const activeRef = useRef(0);
  const currentClipRef = useRef<string | undefined>(undefined);
  const listRef = useRef<string[]>([]);
  const tokenRef = useRef(0);
  const [opacity, setOpacity] = useState<[number, number]>([1, 0]);

  const playClip = useCallback((clip: string | undefined) => {
    if (!clip) return;
    const token = ++tokenRef.current;
    const cur = videoRefs[activeRef.current].current;
    // Same clip requested: restart in place, no crossfade needed
    if (clip === currentClipRef.current && cur && cur.src) {
      if (cur.ended || cur.paused) { cur.currentTime = 0; cur.play().catch(() => {}); }
      return;
    }
    const nextIdx = 1 - activeRef.current;
    const next = videoRefs[nextIdx].current;
    if (!next) return;
    next.src = resolve(clip);
    next.currentTime = 0;
    next.play().then(() => {
      if (token !== tokenRef.current) return; // a newer request won
      const prevIdx = activeRef.current;
      activeRef.current = nextIdx;
      currentClipRef.current = clip;
      setOpacity(nextIdx === 0 ? [1, 0] : [0, 1]);
      setTimeout(() => {
        if (activeRef.current !== prevIdx) videoRefs[prevIdx].current?.pause();
      }, crossfadeMs + 50);
    }).catch((err) => console.error('[VideoAvatar] play failed', clip, err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve, crossfadeMs]);

  // Switch clip set whenever the state (or emotion while talking) changes
  useEffect(() => {
    if (!clips) return;
    const list = clipsFor(clipState, clips, speech.expression);
    listRef.current = list;
    if (!list.includes(currentClipRef.current ?? '')) playClip(pick(list));
  }, [clipState, speech.expression, clips, playClip]);

  // When the active clip ends, continue with another clip from the current set
  const onEnded = useCallback((idx: number) => {
    if (idx !== activeRef.current) return;
    playClip(pick(listRef.current, currentClipRef.current) ?? currentClipRef.current);
  }, [playClip]);

  // Preload every clip once so switches are instant
  useEffect(() => {
    if (!clips) return undefined;
    const all = new Set<string>([
      ...clips.idle, ...(clips.talking ?? []), ...(clips.listening ?? []), ...(clips.thinking ?? []),
      ...Object.values(clips.talkingByEmotion ?? {}).flat(),
    ]);
    const els = [...all].map((c) => {
      const v = document.createElement('video');
      v.preload = 'auto'; v.muted = true; v.crossOrigin = 'anonymous'; v.src = resolve(c);
      return v;
    });
    return () => { els.forEach((v) => { v.src = ''; }); };
  }, [clips, resolve]);

  // ---------- layout: drag + wheel resize, persisted per viewer ----------
  // Compact pet window: she fills the window and dragging/scrolling moves/resizes the window itself.
  const petFullscreen = usePetFullscreen();
  const compactPet = isPet && !petFullscreen && !!electronApi;
  const [storedLayout, setLayout] = useState<Layout>(loadLayout);
  const layout = compactPet ? { x: 0, y: 0, scale: 1 } : storedLayout;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const lastScreenRef = useRef({ x: 0, y: 0 });
  const baseHeight = compactPet ? 100 : (isPet ? 70 : 92); // % of the canvas height at scale 1

  // ---------- pixel hit test on the visible frame (alpha channel) ----------
  const probe = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    return c.getContext('2d', { willReadFrequently: true });
  }, []);

  const hitTest = useCallback((clientX: number, clientY: number): boolean => {
    const v = videoRefs[activeRef.current].current;
    if (!v) return false;
    const r = v.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    if (!probe || !v.videoWidth) return true;
    try {
      const sx = ((clientX - r.left) / r.width) * v.videoWidth;
      const sy = ((clientY - r.top) / r.height) * v.videoHeight;
      probe.clearRect(0, 0, 1, 1);
      probe.drawImage(v, sx, sy, 1, 1, 0, 0, 1, 1);
      return probe.getImageData(0, 0, 1, 1).data[3] > 24;
    } catch {
      return true; // tainted canvas etc.: fall back to the bounding box
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  // Pet mode: tell the main process when the cursor is over her, so clicks go through elsewhere
  const hoverRef = useRef(false);
  const draggingRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!isPet || !electronApi) return undefined;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const hit = draggingRef.current ? true : hitTest(e.clientX, e.clientY);
        if (hit !== hoverRef.current) {
          hoverRef.current = hit;
          electronApi.ipcRenderer.send('update-component-hover', HOVER_ID, hit);
        }
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
      if (hoverRef.current) {
        hoverRef.current = false;
        electronApi.ipcRenderer.send('update-component-hover', HOVER_ID, false);
      }
    };
  }, [isPet, electronApi, hitTest]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !hitTest(e.clientX, e.clientY)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = {
      startX: e.clientX, startY: e.clientY, x: layoutRef.current.x, y: layoutRef.current.y,
    };
    lastScreenRef.current = { x: e.screenX, y: e.screenY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = draggingRef.current;
    if (!d) return;
    if (compactPet) {
      movePetWindowBy(e.screenX - lastScreenRef.current.x, e.screenY - lastScreenRef.current.y);
      lastScreenRef.current = { x: e.screenX, y: e.screenY };
      return;
    }
    setLayout((l) => ({ ...l, x: d.x + e.clientX - d.startX, y: d.y + e.clientY - d.startY }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!compactPet) saveLayout(layoutRef.current);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (modelInfo?.scrollToResize === false || !hitTest(e.clientX, e.clientY)) return;
    if (compactPet) { resizePetWindowBy(e.deltaY < 0 ? 1.06 : 0.94); return; }
    const scale = Math.min(2, Math.max(0.3, layoutRef.current.scale * (e.deltaY < 0 ? 1.06 : 0.94)));
    const next = { ...layoutRef.current, scale };
    setLayout(next);
    saveLayout(next);
  };
  const onContextMenu = (e: React.MouseEvent) => {
    if (!isPet) return;
    e.preventDefault();
    window.api?.showContextMenu?.();
  };

  if (!clips || !clips.idle?.length) {
    return <div style={{ color: '#f66', padding: 16 }}>Video avatar: model_dict entry has no videoClips.idle</div>;
  }

  const videoStyle = (o: number): React.CSSProperties => ({
    position: 'absolute',
    bottom: 0,
    left: '50%',
    height: '100%',
    width: 'auto',
    transform: 'translateX(-50%)',
    opacity: o,
    transition: `opacity ${crossfadeMs}ms linear`,
    pointerEvents: 'none',
    userSelect: 'none',
  });

  return (
    <div
      id="live2d-internal-wrapper"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        pointerEvents: isPet && forceIgnoreMouse ? 'none' : 'auto',
        cursor: draggingRef.current ? 'grabbing' : 'default',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${baseHeight * layout.scale}%`,
          transform: `translate(${layout.x}px, ${layout.y}px)`,
        }}
      >
        {[0, 1].map((i) => (
          <video
            key={i}
            ref={videoRefs[i]}
            style={videoStyle(opacity[i])}
            muted
            playsInline
            crossOrigin="anonymous"
            preload="auto"
            onEnded={() => onEnded(i)}
          />
        ))}
      </div>
    </div>
  );
});

VideoAvatar.displayName = 'VideoAvatar';
