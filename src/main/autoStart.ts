/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { stripIndent } from "shared/utils/text";

import { requestBackground } from "./dbus";
import { Settings, State } from "./settings";
import { escapeDesktopFileArgument } from "./utils/desktopFileEscape";

interface AutoStart {
    isEnabled(): boolean;
    enable(): void;
    disable(): void;
}

function getEscapedCommandLine() {
    const args = process.argv.map(escapeDesktopFileArgument);
    if (Settings.store.autoStartMinimized) args.push("--start-minimized");
    return args;
}

function makeAutoStartLinuxDesktop(): AutoStart {
    const configDir = process.env.XDG_CONFIG_HOME || join(process.env.HOME!, ".config");
    const dir = join(configDir, "autostart");
    const file = join(dir, "vesktop.desktop");

    return {
        isEnabled: () => existsSync(file),
        enable() {
            const desktopFile = stripIndent`
                [Desktop Entry]
                Type=Application
                Name=Vesktop
                Comment=Vesktop autostart script
                Exec=${getEscapedCommandLine().join(" ")}
                StartupNotify=false
                Terminal=false
                Icon=vesktop
            `;

            mkdirSync(dir, { recursive: true });
            writeFileSync(file, desktopFile);
        },
        disable: () => rmSync(file, { force: true })
    };
}

function makeAutoStartLinuxPortal() {
    return {
        isEnabled: () => State.store.linuxAutoStartEnabled === true,
        enable() {
            if (requestBackground(true, getEscapedCommandLine())) {
                State.store.linuxAutoStartEnabled = true;
                return true;
            }
            return false;
        },
        disable() {
            if (requestBackground(false, [])) {
                State.store.linuxAutoStartEnabled = false;
                return true;
            }
            return false;
        }
    };
}

function makeAutoStartLinux(): AutoStart {
    // Not all DEs support the Background portal, so have a .desktop file fallback. https://wiki.archlinux.org/title/XDG_Desktop_Portal#List_of_backends_and_interfaces
    const portal = makeAutoStartLinuxPortal();
    const desktop = makeAutoStartLinuxDesktop();
    const isFlatpak = process.env.FLATPAK_ID !== undefined;

    return {
        isEnabled: () => portal.isEnabled() || desktop.isEnabled(),
        enable() {
            desktop.disable(); // disable fallback to ensure only one is used

            if (!portal.enable() && !isFlatpak) {
                desktop.enable();
            }
        },
        disable() {
            portal.disable();
            desktop.disable();
        }
    };
}

const autoStartWindowsMac: AutoStart = {
    isEnabled: () => app.getLoginItemSettings().openAtLogin,
    enable: () =>
        app.setLoginItemSettings({
            openAtLogin: true,
            args: Settings.store.autoStartMinimized ? ["--start-minimized"] : []
        }),
    disable: () => app.setLoginItemSettings({ openAtLogin: false })
};

export const autoStart = process.platform === "linux" ? makeAutoStartLinux() : autoStartWindowsMac;

Settings.addChangeListener("autoStartMinimized", () => {
    if (!autoStart.isEnabled()) return;

    autoStart.enable();
});
