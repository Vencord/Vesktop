/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { BrowserWindow, ipcMain } from "electron";
import { existsSync } from "fs";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";

import { getWindowProcessId, supportsProcessLoopback } from "./dbus";

interface ActiveCapture {
    child: ChildProcessWithoutNullStreams;
}

let activeCapture: ActiveCapture | null = null;

function stopCapture() {
    activeCapture?.child.kill();
    activeCapture = null;
}

function getWindowHandleFromSourceId(sourceId: string) {
    const [kind, handle] = sourceId.split(":");
    if (kind !== "window" || !handle) return null;
    return handle;
}

ipcMain.handle(IpcEvents.WIN_APP_AUDIO_START, (event, sourceId: string) => {
    stopCapture();

    if (process.platform !== "win32" || !supportsProcessLoopback()) {
        return null;
    }

    const windowHandle = getWindowHandleFromSourceId(sourceId);
    if (!windowHandle) {
        return null;
    }

    const pid = getWindowProcessId(windowHandle);
    if (!pid) {
        return null;
    }

    const helperPath = join(STATIC_DIR, "dist", "vesktop-audio-capture.exe");
    if (!existsSync(helperPath)) {
        console.warn("Windows app audio helper missing:", helperPath);
        return null;
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
        return null;
    }

    const child = spawn(helperPath, [String(pid)], {
        stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", chunk => {
        if (win.isDestroyed()) {
            stopCapture();
            return;
        }

        win.webContents.send(IpcEvents.WIN_APP_AUDIO_DATA, new Uint8Array(chunk));
    });

    child.stderr.on("data", chunk => {
        console.warn("Windows app audio helper:", chunk.toString());
    });

    child.once("exit", () => {
        if (activeCapture?.child === child) {
            activeCapture = null;
        }
    });

    child.once("error", error => {
        console.error("Failed to start Windows app audio helper", error);
        if (activeCapture?.child === child) {
            activeCapture = null;
        }
    });

    activeCapture = {
        child
    };

    return {
        sampleRate: 48000,
        channels: 2,
        bitsPerSample: 16
    };
});

ipcMain.handle(IpcEvents.WIN_APP_AUDIO_STOP, () => {
    stopCapture();
});
