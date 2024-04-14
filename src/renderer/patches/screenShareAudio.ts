/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { isLinux } from "renderer/utils";

if (isLinux) {
    const originalMedia = navigator.mediaDevices.getDisplayMedia;
    const originalDevices = navigator.mediaDevices.enumerateDevices;

    async function getVirtmic() {
        try {
            const devices = await originalDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");
            return audioDevice?.deviceId;
        } catch (error) {
            return null;
        }
    }

    navigator.mediaDevices.enumerateDevices = async function () {
        const result = await originalDevices.call(this);
        return result.filter(x => x.label !== "vencord-screen-share");
    };

    navigator.mediaDevices.getDisplayMedia = async function (opts) {
        const stream = await originalMedia.call(this, opts);
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
