/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "platform-web",
            replacement: {
                // eslint-disable-next-line no-useless-escape
                match: /return (?=__OVERLAY__\?""\.concat\((\i))/,
                replace: "$1=$self.getPlatformClass(); return "
            }
        }
    ],

    getPlatformClass() {
        const platform = navigator.platform.toLowerCase();

        if (platform.includes("mac")) return "platform-osx";
        if (platform.includes("win")) return "platform-win";
        if (platform.includes("linux")) return "platform-linux";

        return "platform-web";
    }
});
