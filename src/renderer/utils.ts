/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord deletes this from the window so we need to capture it in a variable
export const { localStorage } = window;

export const isFirstRun = (() => {
    const key = "VCD_FIRST_RUN";
    if (localStorage.getItem(key) !== null) return false;
    localStorage.setItem(key, "false");
    return true;
})();

const { platform } = navigator;

export const isWindows = platform.startsWith("Win");
export const isMac = platform.startsWith("Mac");
export const isLinux = platform.startsWith("Linux");

type ClassNameFactoryArg = string | string[] | Record<string, unknown> | false | null | undefined | 0 | "";
/**
 * @param prefix The prefix to add to each class, defaults to `""`
 * @returns A classname generator function
 * @example
 * const cl = classNameFactory("plugin-");
 *
 * cl("base", ["item", "editable"], { selected: null, disabled: true })
 * // => "plugin-base plugin-item plugin-editable plugin-disabled"
 */
export const classNameFactory =
    (prefix: string = "") =>
    (...args: ClassNameFactoryArg[]) => {
        const classNames = new Set<string>();
        for (const arg of args) {
            if (arg && typeof arg === "string") classNames.add(arg);
            else if (Array.isArray(arg)) arg.forEach(name => classNames.add(name));
            else if (arg && typeof arg === "object")
                Object.entries(arg).forEach(([name, value]) => value && classNames.add(name));
        }
        return Array.from(classNames, name => prefix + name).join(" ");
    };
