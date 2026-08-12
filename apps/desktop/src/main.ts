/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { app, BrowserWindow, nativeImage, session, shell } from "electron";
import { join } from "node:path";
import { open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { updateElectronApp } from "update-electron-app";
import { startCliServer, stopCliServer, isHeadless } from "./cli-server";
import { trackInstall } from "./analytics";
import { setupAppMenu } from "./menu";
import { mainBridge } from "./main-manager";
import { MAIN_CHANNELS } from "./main-channels";
import type { DeepLinkChannel, WhisperProgress } from "./main-channels";
import { whisperStatus, installWhisper, transcribeAudio } from "./whisper";
import type { LogEntry } from "@diffusionstudio/cli/protocol";

const DEV_URL = "http://localhost:5173";
const AUTH_PROTOCOL = "diffusion";
const MACOS_CORNER_RADIUS = 16;
const MACOS_BACKDROP = { blur: 80, red: 0.07, green: 0.07, blue: 0.07, alpha: 0.9 };

app.setName("Diffusion Studio");
app.commandLine.appendSwitch("enable-blink-features", "CanvasDrawElement");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

let setNativeCornerRadius: ((handle: Buffer, radius: number) => void) | null = null;
let setNativeBackdrop:
  | ((handle: Buffer, blur: number, r: number, g: number, b: number, a: number) => void)
  | null = null;

if (process.platform === "darwin") {
  ({ setCornerRadius: setNativeCornerRadius, setBackdrop: setNativeBackdrop } = require(
    join(app.getAppPath(), "dist", "corner_radius.node"),
  ));
}

function applyCornerRadius(radius: number) {
  if (!setNativeCornerRadius || !mainWindow || mainWindow.isDestroyed()) return;
  setNativeCornerRadius(mainWindow.getNativeWindowHandle(), radius);
}

function applyBackdrop() {
  if (!setNativeBackdrop || !mainWindow || mainWindow.isDestroyed()) return;
  const { blur, red, green, blue, alpha } = MACOS_BACKDROP;
  setNativeBackdrop(mainWindow.getNativeWindowHandle(), blur, red, green, blue, alpha);
}

if (app.isPackaged && !process.argv.includes("--hidden")) {
  updateElectronApp({ repo: "diffusionstudio/editor" });
}

const openWrites = new Map<string, { handle: FileHandle; path: string }>();

let mainWindow: BrowserWindow | null = null;

// Deep links that arrived before the renderer could take them, keyed by the
// channel they belong to so auth and checkout never drain each other's link.
const pendingDeepLinks = new Map<DeepLinkChannel, string>();

// Renderer console mirror, served to the CLI via LOGS_GET. Lives in main so
// it survives reloads and captures everything the devtools console shows
// (page logs, worker logs, uncaught errors) without touching the web bundle.
const LOG_BUFFER_MAX = 2000;
const logBuffer: LogEntry[] = [];

function pushLog(level: LogEntry["level"], message: string, source: string) {
  logBuffer.push({ ts: Date.now(), level, message, source });
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

function captureConsole(window: BrowserWindow) {
  window.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    pushLog(level, message, sourceId ? `${sourceId}:${lineNumber}` : "");
  });
  window.webContents.on("preload-error", (_event, path, error) => {
    pushLog("error", `Preload error: ${error.message}`, path);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    pushLog("error", `Renderer process gone: ${details.reason} (exit code ${details.exitCode})`, "");
  });
}

function findProtocolUrl(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${AUTH_PROTOCOL}://`)) ?? null;
}

function isHiddenLaunch(argv: string[]): boolean {
  return argv.includes("--hidden");
}

// diffusion://auth/callback → auth, diffusion://checkout/callback → checkout.
function deepLinkChannel(url: string): DeepLinkChannel | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }

  if (host === "auth") return MAIN_CHANNELS.AUTH_CALLBACK;
  if (host === "checkout") return MAIN_CHANNELS.CHECKOUT_CALLBACK;
  return null;
}

function deliverDeepLink(url: string) {
  const channel = deepLinkChannel(url);
  if (!channel) return;

  // A link that arrives before the page can receive it is parked rather than
  // pushed: the renderer's subscription only exists once the component holding
  // it mounts, which is well after did-finish-load. Parked links are handed
  // over by the take* handlers below, which every consumer calls on mount.
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingDeepLinks.set(channel, url);
    return;
  }

  mainBridge.emit(mainWindow, channel, { url });
}

function takePendingDeepLink(channel: DeepLinkChannel): string | null {
  const url = pendingDeepLinks.get(channel) ?? null;
  pendingDeepLinks.delete(channel);
  return url;
}

async function setFileInputFiles(selector: string, absolutePath: string) {
  if (!mainWindow) throw new Error("No main window");
  const wc = mainWindow.webContents;
  // Stay attached between calls — attach/detach dominates the cost of a
  // transfer, and file materialization happens in bursts.
  if (!wc.debugger.isAttached()) wc.debugger.attach("1.3");
  const { root } = await wc.debugger.sendCommand("DOM.getDocument");
  const { nodeId } = await wc.debugger.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`Selector not found: ${selector}`);
  await wc.debugger.sendCommand("DOM.setFileInputFiles", {
    files: [absolutePath],
    nodeId,
  });
}

function createWindow(show = true) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 14 },
    ...(process.platform === "darwin"
      ? { vibrancy: "sidebar" as const, backgroundColor: "#00000000" }
      : { backgroundColor: "#1c1c1c" }),
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.js"),
    },
  });

  captureConsole(mainWindow);

  applyCornerRadius(MACOS_CORNER_RADIUS);
  applyBackdrop();

  mainWindow.once("ready-to-show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();

    if (show) {
      mainWindow?.show();
    }
  });

  mainWindow.on("show", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    applyBackdrop();
  });

  mainWindow.on("enter-full-screen", () => {
    applyCornerRadius(0);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    applyCornerRadius(MACOS_CORNER_RADIUS);
    mainBridge.emit(mainWindow, MAIN_CHANNELS.WINDOW_FULLSCREEN_CHANGE, { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(join(app.getAppPath(), "web", "index.html"));
  }
}

if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL, process.execPath, [
    join(process.cwd(), process.argv[1]!),
  ]);
} else {
  app.setAsDefaultProtocolClient(AUTH_PROTOCOL);
}

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", (_event, argv) => {
    const url = findProtocolUrl(argv);
    if (url) deliverDeepLink(url);

    const hidden = isHiddenLaunch(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (hidden) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow(!hidden);
    }
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverDeepLink(url);
  });

  mainBridge.handle(MAIN_CHANNELS.APP_OPEN_EXTERNAL, ({ url }) => shell.openExternal(url));
  mainBridge.handle(MAIN_CHANNELS.AUTH_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.AUTH_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.CHECKOUT_GET_PENDING_CALLBACK, () =>
    takePendingDeepLink(MAIN_CHANNELS.CHECKOUT_CALLBACK),
  );
  mainBridge.handle(MAIN_CHANNELS.WINDOW_IS_FULLSCREEN, () => mainWindow?.isFullScreen() ?? false);
  mainBridge.handle(MAIN_CHANNELS.WINDOW_CAPTURE, async () => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("No main window");
    const image = await mainWindow.webContents.capturePage(undefined, { stayHidden: true });
    const { width, height } = image.getSize();
    return { base64: image.toPNG().toString("base64"), width, height };
  });
  mainBridge.handle(MAIN_CHANNELS.HEADLESS_GET_MODE, () => isHeadless());
  mainBridge.handle(MAIN_CHANNELS.LOGS_GET, () => logBuffer);

  // Local transcription. Progress is pushed as an event so a long first-run
  // install (a model download, or a source build) is visible rather than a hang.
  const relayWhisperProgress = (progress: WhisperProgress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainBridge.emit(mainWindow, MAIN_CHANNELS.WHISPER_PROGRESS, progress);
    }
  };
  mainBridge.handle(MAIN_CHANNELS.WHISPER_STATUS, (req) => whisperStatus(req?.model));
  mainBridge.handle(MAIN_CHANNELS.WHISPER_INSTALL, (req) =>
    installWhisper(req?.model, relayWhisperProgress),
  );
  mainBridge.handle(MAIN_CHANNELS.WHISPER_TRANSCRIBE, ({ audio, extension, model, interactive }) =>
    transcribeAudio(audio, {
      model,
      extension,
      // Headless has nobody to answer a dialog, so it fails with instructions.
      interactive: interactive ?? !isHeadless(),
      onProgress: relayWhisperProgress,
    }),
  );
  mainBridge.handle(MAIN_CHANNELS.FILE_TRANSFER, ({ selector, absolutePath }) =>
    setFileInputFiles(selector, absolutePath),
  );

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_OPEN, async ({ path, exclusive }) => {
    const handle = await open(path, exclusive ? "wx" : "w");
    const id = randomUUID();
    openWrites.set(id, { handle, path });
    return { id };
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CHUNK, async ({ id, data, position }) => {
    const entry = openWrites.get(id);
    if (!entry) throw new Error(`No open file for write id ${id}`);
    await entry.handle.write(data, 0, data.byteLength, position);
  });

  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_CLOSE, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    await entry.handle.close();
  });

  // Abort: close the fd and delete the partial file (cancel / error cleanup).
  mainBridge.handle(MAIN_CHANNELS.FILE_WRITE_ABORT, async ({ id }) => {
    const entry = openWrites.get(id);
    if (!entry) return;
    openWrites.delete(id);
    try {
      await entry.handle.close();
    } finally {
      await unlink(entry.path).catch(() => { });
    }
  });

  app.whenReady().then(() => {
    if (!app.isPackaged && process.platform === "darwin") {
      const devIcon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "icon-dev.png"));
      if (!devIcon.isEmpty()) app.dock?.setIcon(devIcon);
    }

    setupAppMenu();
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setDevicePermissionHandler(() => true);

    const url = findProtocolUrl(process.argv);
    if (url) deliverDeepLink(url);

    startCliServer();
    trackInstall();
    createWindow(!isHiddenLaunch(process.argv));
  });

  app.on("before-quit", () => {
    stopCliServer();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  });
} else {
  app.quit();
}
