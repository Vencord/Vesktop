/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { ChildProcess, execFile } from "child_process";
import { ipcMain } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import { promisify } from "util";

const BIN = join(STATIC_DIR, "virtmic/vencord-virtmic");
const execFileP = promisify(execFile);

ipcMain.handle(IpcEvents.VIRT_MIC_LIST, async () => {
    return execFileP(BIN, ["--list-targets"])
        .then(res =>
            res.stdout
                .trim()
                .split("\n")
                .map(s => s.trim())
                .filter(Boolean)
        )
        .catch(e => {
            console.error("virt-mic-list failed", e);
            return null;
        });
});

let virtMicProc: ChildProcess | null = null;

function kill() {
    virtMicProc?.kill();
    virtMicProc = null;
}

ipcMain.handle(IpcEvents.VIRT_MIC_START, (_, target: string) => {
    kill();

    return new Promise<boolean>(resolve => {
        virtMicProc = execFile(BIN, [target], { encoding: "utf-8" });
        virtMicProc.stdout?.on("data", (chunk: string) => {
            if (chunk.includes("vencord-virtmic")) resolve(true);
        });
        virtMicProc.on("error", () => resolve(false));
        virtMicProc.on("exit", () => resolve(false));

        setTimeout(() => resolve(false), 1000);
    });
});

ipcMain.handle(IpcEvents.VIRT_MIC_KILL, () => kill());
