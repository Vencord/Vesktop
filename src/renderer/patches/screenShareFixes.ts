/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { State } from "renderer/settings";
import { isLinux, isWindows } from "renderer/utils";

const logger = new Logger("VesktopStreamFixes");

if (isLinux || isWindows) {
    const original = navigator.mediaDevices.getDisplayMedia;
    let stopWindowsAudioCapture = () => {};

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
        stopWindowsAudioCapture();
        const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 30);
        const height = Number(State.store.screenshareQuality?.resolution ?? 720);
        const width = Math.round(height * (16 / 9));
        const track = stream.getVideoTracks()[0];
        const selectedKind = currentSettings?.kind;
        const displaySurface = track?.getSettings().displaySurface;

        track.contentHint = String(currentSettings?.contentHint);

        const constraints = {
            ...track.getConstraints(),
            frameRate: { min: frameRate, ideal: frameRate },
            width: { min: 640, ideal: width, max: width },
            height: { min: 480, ideal: height, max: height },
            advanced: [{ width: width, height: height }],
            resizeMode: "none"
        };

        track
            .applyConstraints(constraints)
            .then(() => {
                logger.info("Applied constraints successfully. New constraints: ", track.getConstraints());
            })
            .catch(e => logger.error("Failed to apply constraints.", e));

        if (isWindows && currentSettings?.audio && (selectedKind === "window" || displaySurface === "window")) {
            stream.getAudioTracks().forEach(t => {
                stream.removeTrack(t);
                t.stop();
            });

            const meta = await VesktopNative.winAppAudio.start(currentSettings.id).catch(error => {
                logger.error("Failed to start native Windows app audio capture.", error);
                return null;
            });

            if (!meta) {
                return stream;
            }

            const audioContext = new AudioContext({ sampleRate: meta.sampleRate });
            const processor = audioContext.createScriptProcessor(2048, 0, meta.channels);
            const destination = audioContext.createMediaStreamDestination();

            const pendingChunks: Float32Array[] = [];
            let currentChunk: Float32Array | undefined;
            let chunkOffset = 0;

            const onData = (chunk: Uint8Array) => {
                const input = new Int16Array(chunk.buffer, chunk.byteOffset, Math.floor(chunk.byteLength / 2));
                const converted = new Float32Array(input.length);

                for (let i = 0; i < input.length; i++) {
                    converted[i] = input[i] / 32768;
                }

                pendingChunks.push(converted);
            };

            processor.onaudioprocess = event => {
                const outputs = Array.from({ length: meta.channels }, (_, index) =>
                    event.outputBuffer.getChannelData(index)
                );

                for (let sample = 0; sample < outputs[0].length; sample++) {
                    if (!currentChunk || chunkOffset >= currentChunk.length) {
                        currentChunk = pendingChunks.shift();
                        chunkOffset = 0;
                    }

                    for (let channel = 0; channel < meta.channels; channel++) {
                        outputs[channel][sample] = currentChunk ? currentChunk[chunkOffset + channel] ?? 0 : 0;
                    }

                    if (currentChunk) {
                        chunkOffset += meta.channels;
                    }
                }
            };

            VesktopNative.winAppAudio.onData(onData);
            processor.connect(destination);
            void audioContext.resume();

            const replacementTrack = destination.stream.getAudioTracks()[0];
            if (replacementTrack) {
                stream.addTrack(replacementTrack);
            }

            stopWindowsAudioCapture = () => {
                VesktopNative.winAppAudio.offData(onData);
                void VesktopNative.winAppAudio.stop();
                processor.disconnect();
                void audioContext.close();
                stopWindowsAudioCapture = () => {};
            };

            const stopOnEnd = () => stopWindowsAudioCapture();
            stream.getTracks().forEach(t => t.addEventListener("ended", stopOnEnd, { once: true }));
            return stream;
        }

        if (isWindows && (selectedKind === "window" || displaySurface === "window")) {
            stream.getAudioTracks().forEach(t => {
                stream.removeTrack(t);
                t.stop();
            });
            stopWindowsAudioCapture();
            return stream;
        }

        if (!isLinux) {
            return stream;
        }

        const id = await getVirtmic();

        if (id) {
            const audio = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: {
                        exact: id
                    },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    sampleSize: 16
                }
            });

            stream.getAudioTracks().forEach(t => stream.removeTrack(t));
            stream.addTrack(audio.getAudioTracks()[0]);
        }

        return stream;
    };
}
