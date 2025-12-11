/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ArRpcEvent =
    | ArRpcActivityEvent
    | ArRpcInviteEvent
    | ArRpcLinkEvent
    | ArRpcVoiceSettingsSetEvent
    | ArRpcVoiceSettingsGetEvent
    | ArRpcVoiceChannelGetEvent;
export type ArRpcHostEvent =
    | ArRpcHostAckInviteEvent
    | ArRpcHostAckLinkEvent
    | ArRpcHostAckVoiceSettingsEvent
    | ArRpcHostAckVoiceChannelEvent
    | ArRpcHostVoiceSettingsDispatchEvent;

export interface VoiceSettingsState {
    mute: boolean;
    deaf: boolean;
    self_mute?: boolean;
    self_deaf?: boolean;
    channel_id?: string | null;
    guild_id?: string | null;
    user_id?: string;
    voice_state?: any;
    session_id?: string;
    suppress?: boolean;
    self_stream?: boolean;
    self_video?: boolean;
    request_to_speak_timestamp?: null;
}

export interface ArRpcActivityEvent {
    type: "activity";
    nonce: string;
    data: string;
}

export interface ArRpcInviteEvent {
    type: "invite";
    nonce: string;
    data: string;
}

export interface ArRpcLinkEvent {
    type: "link";
    nonce: string;
    data: any;
}

export interface ArRpcVoiceSettingsSetEvent {
    type: "voice-set";
    nonce: string;
    data: Partial<VoiceSettingsState>;
}

export interface ArRpcVoiceSettingsGetEvent {
    type: "voice-get";
    nonce: string;
}

export interface ArRpcVoiceChannelGetEvent {
    type: "voice-channel-get";
    nonce: string;
}

export interface ArRpcHostAckInviteEvent {
    type: "ack-invite";
    nonce: string;
    data: boolean;
}

export interface ArRpcHostAckLinkEvent {
    type: "ack-link";
    nonce: string;
    data: boolean;
}

export interface ArRpcHostAckVoiceSettingsEvent {
    type: "ack-voice-set" | "ack-voice-get";
    nonce: string;
    data: VoiceSettingsState | { error: string };
}

export interface ArRpcHostAckVoiceChannelEvent {
    type: "ack-voice-channel";
    nonce: string;
    data: { channel_id: string | null; guild_id?: string | null } | { error: string };
}

export interface ArRpcHostVoiceSettingsDispatchEvent {
    type: "voice-settings-update";
    data: VoiceSettingsState;
}
