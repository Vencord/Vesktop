/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "lastOutputSystemDevice.justChanged",
            replacement: {
                match: /((\w)\.default\.getState\(\).neverShowModal)/,
                replace: "$1 || $self.shouldIgnore($2)"
            }
        }
    ],

    shouldIgnore(state: any) {
        return Object.keys(state?.default?.lastDeviceConnected ?? {})?.[0] === "vencord-screen-share";
    }
});
