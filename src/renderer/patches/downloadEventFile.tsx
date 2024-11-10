/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "discord-event.ics",
            replacement: {
                match: /("discord-event\.ics".{0,10}?)window\.open/,
                replace: "$1$self.downloadEvent"
            }
        }
    ],

    downloadEvent(uri: string) {
        const a = document.createElement("a");
        a.href = uri;
        a.download = "discord-event.ics";

        document.body.appendChild(a);
        a.click();
        setImmediate(() => {
            URL.revokeObjectURL(a.href);
            document.body.removeChild(a);
        });
    }
});
