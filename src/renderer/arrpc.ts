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
const MediaEngineStore = findStoreLazy("MediaEngineStore");
const RTCConnectionStore = findStoreLazy("RTCConnectionStore");
const UserStore = findStoreLazy("UserStore");
const VoiceToggleActions = findLazy(
    m => typeof m?.toggleSelfMute === "function" && typeof m?.toggleSelfDeaf === "function"
);

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"] as any as {
    handleEvent(e: MessageEvent): void;
};

type VoiceState = { mute: boolean; deaf: boolean };

let lastVoiceState: VoiceState = { mute: false, deaf: false };

const getVoiceState = (): VoiceState => ({
    mute:
        MediaEngineStore?.isSelfMute?.() ??
        MediaEngineStore?.isLocalMute?.() ??
        RTCConnectionStore?.isSelfMute?.() ??
        lastVoiceState.mute ??
        false,
    deaf: MediaEngineStore?.isSelfDeaf?.() ?? RTCConnectionStore?.isSelfDeaf?.() ?? lastVoiceState.deaf ?? false
});

type VoiceStatePayload = VoiceState & {
    self_mute: boolean;
    self_deaf: boolean;
    channel_id: string | null;
    guild_id: string | null;
    user_id: string;
    voice_state: any;
    session_id: string;
    suppress: boolean;
    self_stream: boolean;
    self_video: boolean;
    request_to_speak_timestamp: null;
};

const sendVoiceStateUpdate = (state: VoiceState) => {
    lastVoiceState = state;
    const { channel_id, guild_id } = getSelectedVoiceChannel();
    const user_id = UserStore?.getCurrentUser?.()?.id ?? "0";

    const payload: VoiceStatePayload = {
        ...state,
        self_mute: state.mute,
        self_deaf: state.deaf,
        channel_id,
        guild_id,
        user_id,
        voice_state: {
            channel_id,
            guild_id,
            user_id,
            mute: state.mute,
            deaf: state.deaf,
            self_mute: state.mute,
            self_deaf: state.deaf,
            session_id: "arrpc-session",
            suppress: false,
            self_stream: false,
            self_video: false,
            request_to_speak_timestamp: null
        },
        session_id: "arrpc-session",
        suppress: false,
        self_stream: false,
        self_video: false,
        request_to_speak_timestamp: null
    };
    VesktopNative.rpcVoice?.notifyState?.(payload);
};

const refreshVoiceState = () => sendVoiceStateUpdate(getVoiceState());

onceReady.then(() => {
    refreshVoiceState();
    MediaEngineStore?.addChangeListener?.(refreshVoiceState);
    RTCConnectionStore?.addChangeListener?.(refreshVoiceState);
});

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

type PartialVoice = Partial<VoiceState>;

type VoicePatch = Omit<Partial<VoiceState>, "mute" | "deaf"> & {
    toggle?: boolean;
    toggle_mute?: boolean;
    toggle_deaf?: boolean;
    mute?: boolean | "toggle";
    deaf?: boolean | "toggle";
};

async function applyVoiceSettings(partial: VoicePatch) {
    if (!Settings.store.arRPC) throw new Error("arRPC is disabled in settings");
    await onceReady;
    if (!VoiceToggleActions) throw new Error("Unable to locate Discord voice toggle actions");

    const current = getVoiceState();

    const wantToggleMute = partial.toggle === true || partial.toggle_mute === true || partial.mute === "toggle";
    const wantToggleDeaf = partial.toggle === true || partial.toggle_deaf === true || partial.deaf === "toggle";

    let targetMute = wantToggleMute ? !current.mute : typeof partial.mute === "boolean" ? partial.mute : current.mute;
    const targetDeaf = wantToggleDeaf ? !current.deaf : typeof partial.deaf === "boolean" ? partial.deaf : current.deaf;

    // If caller explicitly set deaf and did not mention mute, map mute to match deaf (deafen=>mute, undeafen=>unmute).
    if (typeof partial.deaf === "boolean" && partial.mute === undefined) {
        targetMute = partial.deaf;
    }

    // Simple rule: deafen implies mute. Undeafen leaves mute as requested (defaults handled above).
    if (targetDeaf && !targetMute) targetMute = true;

    console.log("[arRPC voice] request", partial, "current", current, "target", { targetMute, targetDeaf });

    const setState = async (key: "mute" | "deaf", desired: boolean) => {
        let state = getVoiceState();
        if (state[key] === desired) return state;
        for (let attempt = 1; attempt <= 3; attempt++) {
            (key === "mute" ? VoiceToggleActions.toggleSelfMute : VoiceToggleActions.toggleSelfDeaf)();
            await sleep(100);
            state = getVoiceState();
            console.log("[arRPC voice] attempt", attempt, key, "now", state[key], "want", desired);
            if (state[key] === desired) return state;
        }
        return state;
    };

    let latest = current;
    if (targetDeaf !== latest.deaf) latest = await setState("deaf", targetDeaf);
    if (targetMute !== latest.mute) latest = await setState("mute", targetMute);

    lastVoiceState = latest;
    console.log("[arRPC voice] final state", latest);
    sendVoiceStateUpdate(latest);
    return latest;
}

const getSelectedVoiceChannel = () => {
    const channelId =
        RTCConnectionStore?.getChannelId?.() ??
        RTCConnectionStore?.getConnectedChannelId?.() ??
        RTCConnectionStore?.getActiveChannelId?.() ??
        RTCConnectionStore?.getCurrentClientVoiceChannelId?.() ??
        null;

    const guildId =
        RTCConnectionStore?.getGuildId?.() ??
        RTCConnectionStore?.getConnectedGuildId?.() ??
        RTCConnectionStore?.getGuildIdForChannel?.(channelId) ??
        null;

    return { channel_id: channelId ?? null, guild_id: guildId ?? null };
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

onIpcCommand(IpcCommands.RPC_SET_VOICE_SETTINGS, async data => {
    return applyVoiceSettings(data ?? {});
});

onIpcCommand(IpcCommands.RPC_GET_VOICE_SETTINGS, async () => {
    if (!Settings.store.arRPC) throw new Error("arRPC is disabled in settings");

    await onceReady;
    return getVoiceState();
});

onIpcCommand(IpcCommands.RPC_GET_SELECTED_VOICE_CHANNEL, async () => {
    if (!Settings.store.arRPC) throw new Error("arRPC is disabled in settings");

    await onceReady;
    return getSelectedVoiceChannel();
});
