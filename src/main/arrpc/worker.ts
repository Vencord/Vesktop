/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Server from "arrpc";
import { randomUUID } from "crypto";
import { MessagePort, workerData } from "worker_threads";

import { ArRpcEvent, ArRpcHostEvent, VoiceSettingsState } from "./types";

let server: any;

type InviteCallback = (valid: boolean) => void;
type LinkCallback = InviteCallback;

const inviteCallbacks = new Map<string, InviteCallback>();
const linkCallbacks = new Map<string, LinkCallback>();
const voiceCallbacks = new Map<string, (err: string | null, data?: VoiceSettingsState) => void>();
const voiceChannelCallbacks = new Map<
    string,
    (err: string | null, data?: { channel_id: string | null; guild_id?: string | null }) => void
>();

(async function () {
    const { workerPort } = workerData as { workerPort: MessagePort };

    server = await new Server();

    server.on("activity", (data: any) => {
        const event: ArRpcEvent = {
            type: "activity",
            data: JSON.stringify(data),
            nonce: randomUUID()
        };
        workerPort.postMessage(event);
    });

    server.on("invite", (invite: string, callback: InviteCallback) => {
        const nonce = randomUUID();
        inviteCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "invite",
            data: invite,
            nonce
        };
        workerPort.postMessage(event);
    });

    server.on("link", async (data: any, callback: LinkCallback) => {
        const nonce = randomUUID();
        linkCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "link",
            data,
            nonce
        };
        workerPort.postMessage(event);
    });

    server.on("voice-settings-set", (data: Partial<VoiceSettingsState>, callback) => {
        const nonce = randomUUID();
        voiceCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "voice-set",
            nonce,
            data
        };

        workerPort.postMessage(event);
    });

    server.on("voice-settings-get", callback => {
        const nonce = randomUUID();
        voiceCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "voice-get",
            nonce
        };

        workerPort.postMessage(event);
    });

    server.on("voice-channel-get", callback => {
        const nonce = randomUUID();
        voiceChannelCallbacks.set(nonce, callback);

        const event: ArRpcEvent = {
            type: "voice-channel-get",
            nonce
        };

        workerPort.postMessage(event);
    });

    workerPort.on("message", (e: ArRpcHostEvent) => {
        switch (e.type) {
            case "ack-invite": {
                inviteCallbacks.get(e.nonce)?.(e.data);
                inviteCallbacks.delete(e.nonce);
                break;
            }
            case "ack-link": {
                linkCallbacks.get(e.nonce)?.(e.data);
                linkCallbacks.delete(e.nonce);
                break;
            }

            case "ack-voice-set":
            case "ack-voice-get": {
                const cb = voiceCallbacks.get(e.nonce);
                if (cb) {
                    if ("error" in e.data) cb(String(e.data.error));
                    else cb(null, e.data as VoiceSettingsState);
                }
                voiceCallbacks.delete(e.nonce);

                if (e.type === "ack-voice-set" && !("error" in e.data)) {
                    server.dispatchVoiceSettings?.(e.data as VoiceSettingsState);
                }
                break;
            }

            case "ack-voice-channel": {
                const cb = voiceChannelCallbacks.get(e.nonce);
                if (cb) {
                    if ("error" in e.data) cb(String(e.data.error));
                    else cb(null, e.data as { channel_id: string | null; guild_id?: string | null });
                }
                voiceChannelCallbacks.delete(e.nonce);
                break;
            }

            case "voice-settings-update": {
                server.dispatchVoiceSettings?.(e.data);
                server.dispatchVoiceState?.(e.data);
                break;
            }
        }
    });
})();
