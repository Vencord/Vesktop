/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./fixes";
import "./appBadge";
import "./patches";

console.log("read if cute :3");

export * as Components from "./components";
import { findByPropsLazy } from "@vencord/types/webpack";
import { FluxDispatcher } from "@vencord/types/webpack/common";

import { Settings } from "./settings";
export { Settings };

const InviteActions = findByPropsLazy("resolveInvite");

export async function openInviteModal(code: string) {
    const { invite } = await InviteActions.resolveInvite(code, "Desktop Modal");
    if (!invite) return false;

    VesktopNative.win.focus();

    FluxDispatcher.dispatch({
        type: "INVITE_MODAL_OPEN",
        invite,
        code,
        context: "APP"
    });

    return true;
}

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"];

arRPC.required = !!Settings.store.arRPC;

Settings.addChangeListener("arRPC", v => {
    arRPC.required = !!v;
    if (v && !arRPC.started) Vencord.Plugins.startPlugin(arRPC);
    else if (arRPC.started) {
        Vencord.Plugins.stopPlugin(arRPC);
    }
});
