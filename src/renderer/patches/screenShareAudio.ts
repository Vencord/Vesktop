/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { isLinux } from "renderer/utils";

const original = navigator.mediaDevices.getDisplayMedia;

export const patchAudioWithDevice = (deviceId?: string) => {
    if (!deviceId) {
        navigator.mediaDevices.getDisplayMedia = original;
        return;
    }

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const stream = await original.call(this, opts);
        const audio = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        const tracks = audio.getAudioTracks();

        tracks.forEach(t => stream.addTrack(t));
        console.log(`Patched stream ${stream.id} with ${tracks.length} audio tracks from ${deviceId}`);

        return stream;
    };
};

if (isLinux) {
    async function getVirtmic() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
            return audioDevice?.deviceId;
        } catch (error) {
            return null;
        }
    }

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const stream = await original.call(this, opts);
        const id = await getVirtmic();

        if (id) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: {
                        exact: id
                    },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false
                }
            });
            audio.getAudioTracks().forEach(t => stream.addTrack(t));
        }

        return stream;
    };
}
