/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

document.addEventListener(
    "focusin",
    ev => {
        console.log(ev);
        if (ev.target && ev.target instanceof HTMLInputElement && ev.target.getAttribute("type") === "password") {
            VencordDesktopNative.secureKeyboardEntry.enable();
        }
    },
    true
);

document.addEventListener(
    "focusout",
    ev => {
        if (ev.target && ev.target instanceof HTMLInputElement && ev.target.getAttribute("type") === "password") {
            VencordDesktopNative.secureKeyboardEntry.disable();
        }
    },
    true
);
