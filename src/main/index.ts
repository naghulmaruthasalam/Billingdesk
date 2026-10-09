import { app, BrowserWindow, Menu, ipcMain, session, shell, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Runtime } from '../core/runtime';
import { dispatch, isKnownChannel } from '../core/api';
import { NATIVE_CHANNELS, IPC_INVOKE } from '../shared/channels';
import { backupsDir, dbFile } from './paths';
import { handleNative, type NativeState } from './native';
import { log } from './logger';

app.setName('Sri Krishna Billing');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const isDev = !!DEV_URL && !app.isPackaged;
const rendererRoot = join(__dirname, '..', 'dist', 'renderer');
const appOrigin = isDev ? new URL(DEV_URL).origin : pathToFileURL(join(rendererRoot, 'index.html')).toString();

let runtime: Runtime | null = null;
let mainWindow: BrowserWindow | null = null;
const state: NativeState = { getWindow: () => mainWindow, lastBackupError: null, rendererRoot };

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

/** Only the application's own page may talk to the main process. */
function trustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  if (isDev) return url.startsWith(appOrigin);
  return url.split('#')[0] === appOrigin;
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // The application is offline-only: nothing may reach the network. (Dev server and DevTools excepted.)
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const allowed = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:') || (isDev && (u.startsWith(DEV_URL) || u.startsWith(`ws://${new URL(DEV_URL).host}`)));
    cb({ cancel: !allowed });
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#FFFFFF',
    title: 'Sri Krishna Billing',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!(isDev ? url.startsWith(appOrigin) : url.split('#')[0] === appOrigin)) {
      e.preventDefault();
      log.warn('blocked navigation to', url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', (e) => e.preventDefault());
  mainWindow.on('closed', () => (mainWindow = null));
  if (isDev) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(join(rendererRoot, 'index.html'));
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(isDev ? ([{ role: 'toggleDevTools' }] as Electron.MenuItemConstructorOptions[]) : [])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function autoBackup(): Promise<void> {
  if (!runtime) return;
  try {
    const info = await runtime.runAutoBackupIfDue();
    if (info) log.info('automatic backup created', info.name);
    state.lastBackupError = null;
  } catch (e) {
    state.lastBackupError = e instanceof Error ? e.message : String(e);
    log.error('automatic backup failed', e);
  }
}

void app.whenReady().then(async () => {
  try {
    runtime = Runtime.open({ dbPath: dbFile(), backupDir: backupsDir() });
    log.info('database opened', dbFile(), 'migrations applied:', runtime.migrationsApplied);
  } catch (e) {
    log.error('failed to open database', e);
    const { dialog } = await import('electron');
    dialog.showErrorBox('Sri Krishna Billing cannot start', `The database could not be opened:\n\n${e instanceof Error ? e.message : String(e)}\n\nYour data has not been modified. See the troubleshooting guide, or restore a backup.`);
    app.exit(1);
    return;
  }
  lockDownSession();
  buildMenu();

  ipcMain.handle(IPC_INVOKE, async (e, channel: unknown, payload: unknown) => {
    if (!trustedSender(e)) {
      log.warn('rejected IPC from untrusted sender', e.senderFrame?.url);
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted caller' } };
    }
    if (typeof channel !== 'string') return { ok: false, error: { code: 'VALIDATION', message: 'Bad request' } };
    const rt = runtime!;
    if ((NATIVE_CHANNELS as readonly string[]).includes(channel)) return handleNative(rt, state, channel, payload);
    if (!isKnownChannel(channel)) return { ok: false, error: { code: 'NOT_FOUND', message: 'Unknown operation' } };
    return dispatch(rt, channel, payload);
  });

  createWindow();
  void autoBackup();
  setInterval(() => void autoBackup(), 30 * 60 * 1000).unref();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    if (runtime?.db.open) {
      runtime.db.pragma('wal_checkpoint(TRUNCATE)');
      runtime.close();
    }
  } catch (e) {
    log.error('error while closing database', e);
  }
});

process.on('uncaughtException', (e) => log.error('uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
void shell;
