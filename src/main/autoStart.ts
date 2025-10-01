/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { requestBackground } from "libvesktop";
import { join } from "path";
import { stripIndent } from "shared/utils/text";

interface AutoStart {
    isEnabled(): boolean;
    enable(): void;
    disable(): void;
}

function makeAutoStartLinuxDesktop(): AutoStart {
    const configDir = process.env.XDG_CONFIG_HOME || join(process.env.HOME!, ".config");
    const dir = join(configDir, "autostart");
    const file = join(dir, "vesktop.desktop");

    // "Quoting must be done by enclosing the argument between double quotes and escaping the double quote character,
    // backtick character ("`"), dollar sign ("$") and backslash character ("\") by preceding it with an additional backslash character"
    // https://specifications.freedesktop.org/desktop-entry-spec/desktop-entry-spec-latest.html#exec-variables
    const commandLine = process.argv.map(arg => '"' + arg.replace(/["$`\\]/g, "\\$&") + '"').join(" ");

    return {
        isEnabled: () => existsSync(file),
        enable() {
            const desktopFile = stripIndent`
                [Desktop Entry]
                Type=Application
                Name=Vesktop
                Comment=Vesktop autostart script
                Exec=${commandLine}
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

// TODO: fix circular dependency hell
const getState = () => (require("./settings") as typeof import("./settings")).State;

function makeAutoStartLinuxPortal() {
    return {
        isEnabled: () => getState().store.linuxAutoStartEnabled === true,
        enable() {
            if (requestBackground(true, process.argv)) {
                getState().store.linuxAutoStartEnabled = true;
                return true;
            }
            return false;
        },
        disable() {
            if (requestBackground(false, process.argv)) {
                getState().store.linuxAutoStartEnabled = false;
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
            if (portal.enable()) {
                desktop.disable(); // disable fallback to ensure only one is used
            } else if (!isFlatpak) {
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
    enable: () => app.setLoginItemSettings({ openAtLogin: true }),
    disable: () => app.setLoginItemSettings({ openAtLogin: false })
};

export const autoStart = process.platform === "linux" ? makeAutoStartLinux() : autoStartWindowsMac;
