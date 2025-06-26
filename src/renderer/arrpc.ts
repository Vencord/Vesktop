/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { findLazy, findStoreLazy, onceReady } from "@vencord/types/webpack";
import { FluxDispatcher, InviteActions } from "@vencord/types/webpack/common";
import { IpcCommands } from "shared/IpcEvents";

import { onIpcCommand } from "./ipcCommands";
import { Settings } from "./settings";

const logger = new Logger("VesktopRPC", "#5865f2");
const StreamerModeStore = findStoreLazy("StreamerModeStore");

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"] as any as {
    handleEvent(e: MessageEvent): void;
};

onIpcCommand(IpcCommands.RPC_ACTIVITY, async jsonData => {
    if (!Settings.store.arRPC) return;

    await onceReady;

    const data = JSON.parse(jsonData);

    if (data.socketId === "STREAMERMODE" && StreamerModeStore.autoToggle) {
        FluxDispatcher.dispatch({
            type: "STREAMER_MODE_UPDATE",
            key: "enabled",
            value: data.activity?.application_id === "STREAMERMODE"
        });
        return;
    }

    arRPC.handleEvent(new MessageEvent("message", { data: jsonData }));
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

const { DEEP_LINK } = findLazy(m => m.DEEP_LINK?.handler);

onIpcCommand(IpcCommands.RPC_DEEP_LINK, async data => {
    logger.debug("Opening deep link:", data);
    try {
        DEEP_LINK.handler({ args: data });
        return true;
    } catch (err) {
        logger.error("Failed to open deep link:", err);
        return false;
    }
});
