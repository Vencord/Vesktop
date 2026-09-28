/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const spawnAsync = promisify(spawn);

/** @type {import("electron-builder").CustomWindowsSign} */
export function sign({ path, resultOutputPath }) {
    if (!process.env.CI) {
        console.log("Not signing because this isn't CI");
        return;
    }
    
    resultOutputPath ??= path;

    return spawnAsync(join(import.meta.dirname, "sign.ps1"), [path, resultOutputPath], {
        shell: "powershell",
        stdio: "inherit",
        windowsHide: true
    });
}
