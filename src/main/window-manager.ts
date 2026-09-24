import {
  BrowserWindow, screen, shell, ipcMain, app,
} from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { is } from '@electron-toolkit/utils';

const isMac = process.platform === 'darwin';

type Bounds = { x: number; y: number; width: number; height: number };

interface PetSettings {
  /** true: pet window spans every display. false: compact floating window. */
  petFullscreen: boolean;
  compactBounds?: Bounds;
}

const PET_SETTINGS_FILE = () => join(app.getPath('userData'), 'pet-settings.json');
const COMPACT_DEFAULT = { width: 420, height: 640 };
const COMPACT_MIN_HEIGHT = 240;

function loadPetSettings(): PetSettings {
  try {
    return { petFullscreen: false, ...JSON.parse(readFileSync(PET_SETTINGS_FILE(), 'utf-8')) };
  } catch {
    return { petFullscreen: false };
  }
}

function savePetSettings(s: PetSettings): void {
  try { writeFileSync(PET_SETTINGS_FILE(), JSON.stringify(s, null, 2)); } catch (e) { console.error('pet-settings save failed', e); }
}

export class WindowManager {
  private window: BrowserWindow | null = null;

  private windowedBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  private hoveringComponents: Set<string> = new Set();

  private currentMode: 'window' | 'pet' = 'window';

  // Track if mouse events are forcibly ignored
  private forceIgnoreMouse = false;

  private petSettings: PetSettings = loadPetSettings();

  private saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    ipcMain.handle('get-pet-fullscreen', () => this.petSettings.petFullscreen);

    // Compact pet window: renderer drags / wheel-resizes the window itself
    ipcMain.on('pet-window-move-by', (_event, dx: number, dy: number) => {
      if (!this.window || this.currentMode !== 'pet' || this.petSettings.petFullscreen) return;
      const b = this.window.getBounds();
      this.window.setBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
      this.rememberCompactBounds();
    });

    // Corner grip: resize the compact pet window by a pixel delta (top-left stays put)
    ipcMain.on('pet-window-resize-drag', (_event, dw: number, dh: number) => {
      if (!this.window || this.currentMode !== 'pet' || this.petSettings.petFullscreen) return;
      const b = this.window.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const width = Math.round(Math.min(wa.width, Math.max(200, b.width + dw)));
      const height = Math.round(Math.min(wa.height, Math.max(COMPACT_MIN_HEIGHT, b.height + dh)));
      this.window.setBounds({
        x: b.x, y: b.y, width, height,
      });
      this.rememberCompactBounds();
    });

    ipcMain.on('pet-window-resize-by', (_event, factor: number) => {
      if (!this.window || this.currentMode !== 'pet' || this.petSettings.petFullscreen) return;
      const b = this.window.getBounds();
      const wa = screen.getDisplayMatching(b).workArea;
      const height = Math.round(Math.min(wa.height, Math.max(COMPACT_MIN_HEIGHT, b.height * factor)));
      const width = Math.round((b.width / b.height) * height);
      // keep bottom-centre anchored so she grows upwards
      this.window.setBounds({
        x: Math.round(b.x + (b.width - width) / 2), y: b.y + b.height - height, width, height,
      });
      this.rememberCompactBounds();
    });
    ipcMain.on('renderer-ready-for-mode-change', (_event, newMode) => {
      if (newMode === 'pet') {
        setTimeout(() => {
          this.continueSetWindowModePet();
        }, 500);
      } else {
        setTimeout(() => {
          this.continueSetWindowModeWindow();
        }, 500);
      }
    });

    ipcMain.on('mode-change-rendered', () => {
      this.window?.setOpacity(1);
    });

    ipcMain.on('window-unfullscreen', () => {
      const window = this.getWindow();
      if (window && window.isFullScreen()) {
        window.setFullScreen(false);
      }
    });

    // Handle toggle force ignore mouse events from renderer
    ipcMain.on('toggle-force-ignore-mouse', () => {
      this.toggleForceIgnoreMouse();
    });
  }

  createWindow(options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
    this.window = new BrowserWindow({
      width: 900,
      height: 670,
      show: false,
      transparent: true,
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      frame: false,
      icon: process.platform === 'win32'
        ? join(__dirname, '../../resources/icon.ico')
        : join(__dirname, '../../resources/icon.png'),
      ...(isMac ? { titleBarStyle: 'hiddenInset' } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: true,
      },
      hasShadow: false,
      paintWhenInitiallyHidden: true,
      ...options,
    });

    this.setupWindowEvents();
    this.loadContent();

    this.window.on('enter-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', true);
    });

    this.window.on('leave-full-screen', () => {
      this.window?.webContents.send('window-fullscreen-change', false);
    });

    return this.window;
  }

  private setupWindowEvents(): void {
    if (!this.window) return;

    this.window.on('ready-to-show', () => {
      this.window?.show();
      this.window?.webContents.send(
        'window-maximized-change',
        this.window.isMaximized(),
      );
    });

    this.window.on('maximize', () => {
      this.window?.webContents.send('window-maximized-change', true);
    });

    this.window.on('unmaximize', () => {
      this.window?.webContents.send('window-maximized-change', false);
    });

    this.window.on('resize', () => {
      const window = this.getWindow();
      if (window) {
        const bounds = window.getBounds();
        const { width, height } = screen.getPrimaryDisplay().workArea;
        const isMaximized = bounds.width >= width && bounds.height >= height;
        window.webContents.send('window-maximized-change', isMaximized);
      }
    });

    this.window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: 'deny' };
    });
  }

  private loadContent(): void {
    if (!this.window) return;

    if (is.dev && process.env.ELECTRON_RENDERER_URL) {
      this.window.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.window.loadFile(join(__dirname, '../renderer/index.html'));
    }
  }

  setWindowMode(mode: 'window' | 'pet'): void {
    if (!this.window) return;

    this.currentMode = mode;
    this.window.setOpacity(0);

    if (mode === 'window') {
      this.setWindowModeWindow();
    } else {
      this.setWindowModePet();
    }
  }

  private setWindowModeWindow(): void {
    if (!this.window) return;

    this.window.setAlwaysOnTop(false);
    this.window.setIgnoreMouseEvents(false);
    this.window.setSkipTaskbar(false);
    this.window.setResizable(true);
    this.window.setFocusable(true);
    this.window.setAlwaysOnTop(false);

    this.window.setBackgroundColor('#ffffff');
    this.window.webContents.send('pre-mode-changed', 'window');
  }

  private continueSetWindowModeWindow(): void {
    if (!this.window) return;
    if (this.windowedBounds) {
      this.window.setBounds(this.windowedBounds);
    } else {
      this.window.setSize(900, 670);
      this.window.center();
    }

    if (isMac) {
      this.window.setWindowButtonVisibility(true);
      this.window.setVisibleOnAllWorkspaces(false, {
        visibleOnFullScreen: false,
      });
    }

    this.window?.setIgnoreMouseEvents(false, { forward: true });

    this.window.webContents.send('mode-changed', 'window');
  }

  private setWindowModePet(): void {
    if (!this.window) return;

    this.windowedBounds = this.window.getBounds();

    if (this.window.isFullScreen()) {
      this.window.setFullScreen(false);
    }

    this.window.setBackgroundColor('#00000000');

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setPosition(0, 0);

    this.window.webContents.send('pre-mode-changed', 'pet');
  }

  /** Bounds for pet mode: whole virtual screen, or the compact floating window. */
  private getPetBounds(): Bounds {
    if (this.petSettings.petFullscreen) {
      // Cover all displays so the avatar can be dragged between monitors.
      const displays = screen.getAllDisplays();
      const minX = Math.min(...displays.map((d) => d.bounds.x));
      const minY = Math.min(...displays.map((d) => d.bounds.y));
      const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
      const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
      return {
        x: minX, y: minY, width: maxX - minX, height: maxY - minY,
      };
    }
    const saved = this.petSettings.compactBounds;
    // Only reuse saved bounds if they are still on a connected display
    if (saved && screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return saved.x + saved.width / 2 >= wa.x && saved.x + saved.width / 2 <= wa.x + wa.width
        && saved.y + saved.height / 2 >= wa.y && saved.y + saved.height / 2 <= wa.y + wa.height;
    })) return saved;
    const wa = screen.getPrimaryDisplay().workArea;
    const height = Math.min(COMPACT_DEFAULT.height, wa.height);
    const width = Math.min(COMPACT_DEFAULT.width, wa.width);
    return {
      x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height, width, height,
    };
  }

  private rememberCompactBounds(): void {
    if (!this.window || this.petSettings.petFullscreen) return;
    this.petSettings.compactBounds = this.window.getBounds();
    if (this.saveBoundsTimer) clearTimeout(this.saveBoundsTimer);
    this.saveBoundsTimer = setTimeout(() => savePetSettings(this.petSettings), 500);
  }

  isPetFullscreen(): boolean {
    return this.petSettings.petFullscreen;
  }

  setPetFullscreen(fullscreen: boolean): void {
    this.petSettings.petFullscreen = fullscreen;
    savePetSettings(this.petSettings);
    this.window?.webContents.send('pet-fullscreen-changed', fullscreen);
    if (this.window && this.currentMode === 'pet') {
      this.window.setBounds(this.getPetBounds());
      this.applyPetMouseState();
    }
  }

  private isCompactPet(): boolean {
    return this.currentMode === 'pet' && !this.petSettings.petFullscreen;
  }

  /**
   * Pet-mode mouse handling. Compact window: the whole small window takes clicks
   * (right-click menu, drag, resize grip work anywhere in it). Fullscreen: click-through
   * except over the character (hover tracking). Force passthrough overrides both.
   */
  private applyPetMouseState(): void {
    if (!this.window || this.currentMode !== 'pet') return;
    let ignore: boolean;
    if (this.forceIgnoreMouse) ignore = true;
    else if (this.isCompactPet()) ignore = false;
    else ignore = this.hoveringComponents.size === 0;
    if (isMac) this.window.setIgnoreMouseEvents(ignore);
    else this.window.setIgnoreMouseEvents(ignore, { forward: true });
    if (!ignore) this.window.setFocusable(true);
  }

  private continueSetWindowModePet(): void {
    if (!this.window) return;
    this.window.setBounds(this.getPetBounds());

    if (isMac) this.window.setWindowButtonVisibility(false);
    this.window.setResizable(false);
    this.window.setSkipTaskbar(true);
    this.window.setFocusable(false);

    if (isMac) {
      this.window.setIgnoreMouseEvents(true);
      this.window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
    } else {
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
    this.applyPetMouseState();

    this.window.webContents.send('mode-changed', 'pet');
  }
  
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    if (!this.window) return;
    // Compact pet window always takes clicks (unless passthrough is forced)
    if (this.isCompactPet()) { this.applyPetMouseState(); return; }

    if (isMac) {
      this.window.setIgnoreMouseEvents(ignore);
      // this.window.setIgnoreMouseEvents(ignore, { forward: true });
    } else {
      this.window.setIgnoreMouseEvents(ignore, { forward: true });
    }
  }

  maximizeWindow(): void {
    if (!this.window) return;

    if (this.isWindowMaximized()) {
      if (this.windowedBounds) {
        this.window.setBounds(this.windowedBounds);
        this.windowedBounds = null;
        this.window.webContents.send('window-maximized-change', false);
      }
    } else {
      this.windowedBounds = this.window.getBounds();
      const { width, height } = screen.getPrimaryDisplay().workArea;
      this.window.setBounds({
        x: 0, y: 0, width, height,
      });
      this.window.webContents.send('window-maximized-change', true);
    }
  }

  isWindowMaximized(): boolean {
    if (!this.window) return false;
    const bounds = this.window.getBounds();
    const { width, height } = screen.getPrimaryDisplay().workArea;
    return bounds.width >= width && bounds.height >= height;
  }

  updateComponentHover(componentId: string, isHovering: boolean): void {
    if (this.currentMode === 'window') return;

    // If force ignore is enabled, don't change the mouse ignore state
    if (this.forceIgnoreMouse) return;

    if (isHovering) {
      this.hoveringComponents.add(componentId);
    } else {
      this.hoveringComponents.delete(componentId);
    }

    this.applyPetMouseState();
  }

  // Toggle force ignore mouse events
  toggleForceIgnoreMouse(): void {
    this.forceIgnoreMouse = !this.forceIgnoreMouse;

    // Apply the new setting immediately
    if (this.currentMode === 'pet') {
      this.applyPetMouseState();
    } else if (this.forceIgnoreMouse) {
      if (isMac) {
        this.window?.setIgnoreMouseEvents(true);
      } else {
        this.window?.setIgnoreMouseEvents(true, { forward: true });
      }
    }

    // Notify renderer about the change
    this.window?.webContents.send('force-ignore-mouse-changed', this.forceIgnoreMouse);
  }

  // Get current force ignore state
  isForceIgnoreMouse(): boolean {
    return this.forceIgnoreMouse;
  }

  // Get current mode
  getCurrentMode(): 'window' | 'pet' {
    return this.currentMode;
  }
}
