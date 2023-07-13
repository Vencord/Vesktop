/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

interface AutoStart {
    isEnabled(): boolean;
    enable(): void;
    disable(): void;
}

function makeAutoStartLinux(): AutoStart {
    const configDir = process.env.XDG_CONFIG_HOME || join(process.env.HOME!, ".config");
    const dir = join(configDir, "autostart");
    const file = join(dir, "vencord.desktop");

    return {
        isEnabled: () => existsSync(file),
        enable() {
            const desktopFile = `
[Desktop Entry]
Type=Application
Version=1.0
Name=Vencord
Comment=Vencord autostart script
Exec=${process.execPath}
Terminal=false
StartupNotify=false
`.trim();

            mkdirSync(dir, { recursive: true });
            writeFileSync(file, desktopFile);
        },
        disable: () => rmSync(file, { force: true })
    };
}

const autoStartWindowsMac: AutoStart = {
    isEnabled: () => app.getLoginItemSettings().openAtLogin,
    enable: () => app.setLoginItemSettings({ openAtLogin: true }),
    disable: () => app.setLoginItemSettings({ openAtLogin: false })
};

export const autoStart = process.platform === "linux" ? makeAutoStartLinux() : autoStartWindowsMac;
