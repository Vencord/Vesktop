/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Based on https://github.com/gergof/electron-builder-sandbox-fix/blob/master/lib/index.js

import fs from "fs/promises";
import path from "path";
import AppImageTarget from "app-builder-lib/out/targets/AppImageTarget.js";

let isApplied = false;

export async function applyAppImageSandboxFix() {
    if (process.platform !== "linux") {
        // this fix is only required on linux
        return;
    }

    if (isApplied) return;
    isApplied = true;

    const oldBuildMethod = AppImageTarget.default.prototype.build;
    AppImageTarget.default.prototype.build = async function (...args) {
        console.log("Running AppImage builder hook", args);
        const oldPath = args[0];
        const newPath = oldPath + "-appimage-sandbox-fix";
        // just in case
        try {
            await fs.rm(newPath, {
                recursive: true
            });
        } catch {}

        console.log("Copying to apply appimage fix", oldPath, newPath);
        await fs.cp(oldPath, newPath, {
            recursive: true
        });
        args[0] = newPath;

        const executable = path.join(newPath, this.packager.executableName);

        const loaderScript = `
#!/usr/bin/env bash

SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
IS_STEAMOS=0

if [[ "$SteamOS" == "1" && "$SteamGamepadUI" == "1" ]]; then
    echo "Running Vesktop on SteamOS, disabling sandbox"
    IS_STEAMOS=1
fi

exec "$SCRIPT_DIR/${this.packager.executableName}.bin" "$([ "$IS_STEAMOS" == 1 ] && echo '--no-sandbox')" "$@"
                `.trim();

        try {
            await fs.rename(executable, executable + ".bin");
            await fs.writeFile(executable, loaderScript);
            await fs.chmod(executable, 0o755);
        } catch (e) {
            console.error("failed to create loder for sandbox fix: " + e.message);
            throw new Error("Failed to create loader for sandbox fix");
        }

        const ret = await oldBuildMethod.apply(this, args);

        await fs.rm(newPath, {
            recursive: true
        });

        return ret;
    };
}
