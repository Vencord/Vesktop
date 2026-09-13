/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "lastOutputSystemDevice.justChanged",
            replacement: {
                match: /\.getState\(\)\.neverShowModal(?=.{0,50}?(\i)\.lastDeviceConnected)/,
                replace: "$& || $self.shouldIgnoreDevice($1)"
            }
        }
    ],

    shouldIgnoreDevice(state: any) {
        return Object.keys(state.lastDeviceConnected ?? {})[0] === "vencord-screen-share";
    }
});
