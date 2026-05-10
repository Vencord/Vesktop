/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: 'setSinkId"in',
            replacement: {
                match: /navigator\.mediaDevices\.enumerateDevices\(\)/,
                replace: "$self.getFilteredDevices()"
            }
        }
    ],

    async getFilteredDevices() {
        const original = await navigator.mediaDevices.enumerateDevices();
        return original.filter(x => x.label !== "vencord-screen-share");
    }
});
