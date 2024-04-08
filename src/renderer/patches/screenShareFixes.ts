/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { currentSettings } from "renderer/components/ScreenSharePicker";
import { isLinux } from "renderer/utils";

if (isLinux) {
    const original = navigator.mediaDevices.getDisplayMedia;

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

        const frameRate = Number(currentSettings?.fps);
        const height = Number(currentSettings?.resolution);
        const width = Math.round(height * (16 / 9));
        var track = stream.getVideoTracks()[0];

        track.contentHint = String(currentSettings?.contentHint);
        var constraints = track.getConstraints();
        const newConstraints = {
            ...constraints,
            frameRate,
            width: { ideal: width },
            height: { ideal: height },
            advanced: [{ width: width, height: height }]
        };

        track.applyConstraints(newConstraints).then(() => {
            console.log("Applied constraints successfully");
            console.log("New settings:", track.getSettings());
        });

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
