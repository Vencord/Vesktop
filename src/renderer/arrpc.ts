/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, InviteActions } from "@vencord/types/webpack/common";
import { IpcCommands } from "shared/IpcEvents";

import { onIpcCommand } from "./ipcCommands";
import { Settings } from "./settings";

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"] as any as {
    handleEvent(e: MessageEvent): void;
};

onIpcCommand(IpcCommands.RPC_ACTIVITY, async data => {
    if (!Settings.store.arRPC) return;

    await onceReady;

    arRPC.handleEvent(new MessageEvent("message", { data }));
});

onIpcCommand(IpcCommands.RPC_INVITE, async code => {
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
});
