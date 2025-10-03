/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { stripIndent } from "shared/utils/text";

import { IS_FLATPAK } from "./constants";
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
            const success = requestBackground(true, getEscapedCommandLine());
            if (success) {
                State.store.linuxAutoStartEnabled = true;
            }
            return success;
        },
        disable() {
            const success = requestBackground(false, []);
            if (success) {
                State.store.linuxAutoStartEnabled = false;
            }
            return success;
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

// The portal call uses the app id by default, which is org.chromium.Chromium, even in packaged Vesktop.
// This leads to an autostart entry named "Chromium" instead of "Vesktop".
// Thus, only use the portal inside Flatpak, where the app is actually correct.
// Maybe there is a way to fix it outside of flatpak, but I couldn't figure it out.
export const autoStart =
    process.platform !== "linux"
        ? autoStartWindowsMac
        : IS_FLATPAK
          ? makeAutoStartLinuxPortal()
          : makeAutoStartLinuxDesktop();

Settings.addChangeListener("autoStartMinimized", () => {
    if (!autoStart.isEnabled()) return;

    autoStart.enable();
});
