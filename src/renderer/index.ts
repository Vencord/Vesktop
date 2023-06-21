/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./fixes";
import "./screenshare";

console.log("read if cute :3");

export * as Components from "./components";
import { Settings } from "./settings";
export { Settings };

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"];

arRPC.required = !!Settings.store.arRPC;

Settings.addChangeListener("arRPC", v => {
    arRPC.required = !!v;
    if (v && !arRPC.started) Vencord.Plugins.startPlugin(arRPC);
    else if (arRPC.started) {
        Vencord.Plugins.stopPlugin(arRPC);
    }
});
