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
                // eslint-disable-next-line no-useless-escape
                match: /(\i)\.\i\.getState\(\).neverShowModal/,
                replace: "$& || $self.shouldIgnore($1)"
            }
        }
    ],

    shouldIgnore(state: any) {
        return Object.keys(state?.default?.lastDeviceConnected ?? {})?.[0] === "vencord-screen-share";
    }
});
