/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { isLinux } from "renderer/utils";

const original = navigator.mediaDevices.getDisplayMedia;

interface ScreenSharePatchOptions {
    videoId?: string;
    audioId?: string;
    venmic?: boolean;
}

async function getVirtmic() {
    if (!isLinux) throw new Error("getVirtmic can not be called on non-Linux platforms!");

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
        return audioDevice?.deviceId;
    } catch (error) {
        return null;
    }
}

export const patchDisplayMedia = (options: ScreenSharePatchOptions) => {
    navigator.mediaDevices.getDisplayMedia = async function (apiOptions) {
        let stream: MediaStream;

        if (options.videoId) {
            stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: options.videoId } } });
        } else {
            stream = await original.call(this, apiOptions);
        }

        if (options.audioId) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: options.audioId },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false
                }
            });
            const tracks = audio.getAudioTracks();
            tracks.forEach(t => stream.addTrack(t));
        } else if (options.venmic === true) {
            const virtmicId = await getVirtmic();

            if (virtmicId) {
                const audio = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: virtmicId },
                        autoGainControl: false,
                        echoCancellation: false,
                        noiseSuppression: false
                    }
                });
                audio.getAudioTracks().forEach(t => stream.addTrack(t));
            }
        }

        return stream;
    };
};
