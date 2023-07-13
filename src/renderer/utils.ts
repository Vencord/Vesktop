/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

export const { localStorage } = window;

export const isFirstRun = (() => {
    const key = "VCD_FIRST_RUN";
    if (localStorage.getItem(key) !== null) return false;
    localStorage.setItem(key, "false");
    return true;
})();

const { platform } = navigator;

export const isWindows = platform.startsWith("Win");
