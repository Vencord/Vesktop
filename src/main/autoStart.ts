/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { spawnSync } from "child_process";
import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

interface AutoStart {
    isEnabled(): boolean;
    enable(): void;
    disable(): void;
}

function requestBackgroundPortal(autostart: boolean, commandline: string[]) {
    const commandlineString = commandline.map(a => `'${a.replaceAll("'", "\\'")}'`).join(", ");

    const { status } = spawnSync(
        "gdbus",
        [
            "call",
            "--session",
            "--dest",
            "org.freedesktop.portal.Desktop",
            "--object-path",
            "/org/freedesktop/portal/desktop",
            "--method",
            "org.freedesktop.portal.Background.RequestBackground",
            "",
            `{'autostart':<${autostart}>,'commandline':<[${commandlineString}]>}`
        ],
        { encoding: "utf-8", stdio: "inherit" }
    );

    return status === 0;
}

// todo: only apply start-minimized if setting is enabled
const LinuxAutoStartPortal = {
    isEnabled: () => "dunno",
    enable: () => requestBackgroundPortal(true, [process.execPath, "--start-minimized"]),
    disable: () => requestBackgroundPortal(false, [])
};

const makeLinuxAutoStartDesktopFile = () => {
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
Exec=${process.execPath} --start-minimized
Terminal=false
StartupNotify=false
`.trim();

            mkdirSync(dir, { recursive: true });
            writeFileSync(file, desktopFile);
        },
        disable: () => rmSync(file, { force: true })
    };
};

function makeAutoStartLinux(): AutoStart {
    const autoStartDesktop = makeLinuxAutoStartDesktopFile();
    const autoStartPortal = LinuxAutoStartPortal;

    return {
        isEnabled: () => autoStartDesktop.isEnabled(),
        enable: () => autoStartPortal.enable() || autoStartDesktop.enable(),
        disable: () => {
            autoStartPortal.disable();
            autoStartDesktop.disable();
        }
    };
}

const autoStartWindowsMac: AutoStart = {
    isEnabled: () => app.getLoginItemSettings().openAtLogin,
    enable: () => app.setLoginItemSettings({ openAtLogin: true }),
    disable: () => app.setLoginItemSettings({ openAtLogin: false })
};

export const autoStart = process.platform === "linux" ? makeAutoStartLinux() : autoStartWindowsMac;
