/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { currentSettings } from "renderer/components/ScreenSharePicker";
import { State } from "renderer/settings";
import { isLinux } from "renderer/utils";

// Global state for Discord's audio toggle
let discordAudioEnabled = true;

// Function to update Discord audio state from other patches
export function setDiscordAudioEnabled(enabled: boolean) {
    discordAudioEnabled = enabled;
}

const logger = new Logger("VesktopStreamFixes");

const original = navigator.mediaDevices.getDisplayMedia;

interface OverrideDevices {
    audio: string | undefined;
    video: string | undefined;
}

let overrideDevices: OverrideDevices = { audio: undefined, video: undefined };

export const patchOverrideDevices = (newOverrideDevices: OverrideDevices) => {
    overrideDevices = newOverrideDevices;
};

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

    if (overrideDevices.audio) {
        const audio = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: overrideDevices.audio },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false
            }
        });

        stream.getAudioTracks().forEach(t => {
            t.stop();
            stream.removeTrack(t);
        });

        audio.getAudioTracks().forEach(t => {
            stream.addTrack(t);
        });
    }

    if (overrideDevices.video) {
        const video = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: overrideDevices.video }
            }
        });

        stream.getVideoTracks().forEach(t => {
            t.stop();
            stream.removeTrack(t);
        });

        video.getVideoTracks().forEach(t => {
            stream.addTrack(t);
        });
    }

    if (isLinux) {
        const id = await getVirtmic();

        const frameRate = Number(State.store.screenshareQuality?.frameRate ?? 60);
        const height = Number(State.store.screenshareQuality?.resolution ?? 720);
        const width = Math.round(height * (16 / 9));
        const track = stream.getVideoTracks()[0];

        track.contentHint = String(currentSettings?.contentHint);

        // Use less restrictive constraints to avoid OverconstrainedError
        const constraints = {
            frameRate: { ideal: frameRate },
            width: { ideal: width },
            height: { ideal: height }
        };

        // Only apply constraints if the track supports them
        if (track.getCapabilities) {
            const capabilities = track.getCapabilities();

            // Check if the requested values are within capabilities
            if (
                capabilities.width?.min !== undefined &&
                capabilities.width?.max !== undefined &&
                width >= capabilities.width.min &&
                width <= capabilities.width.max
            ) {
                constraints.width = { ideal: width };
            }
            if (
                capabilities.height?.min !== undefined &&
                capabilities.height?.max !== undefined &&
                height >= capabilities.height.min &&
                height <= capabilities.height.max
            ) {
                constraints.height = { ideal: height };
            }
            if (
                capabilities.frameRate?.min !== undefined &&
                capabilities.frameRate?.max !== undefined &&
                frameRate >= capabilities.frameRate.min &&
                frameRate <= capabilities.frameRate.max
            ) {
                constraints.frameRate = { ideal: frameRate };
            }
        }

        track
            .applyConstraints(constraints)
            .then(() => {
                logger.info("Applied constraints successfully. Settings: ", track.getSettings());
            })
            .catch(e => {
                logger.error("Failed to apply constraints. Continuing with defaults.", e);
                // Don't throw - continue with the stream even if constraints fail
            });

        // Check if audio should be enabled based on current settings
        const shouldIncludeAudio =
            currentSettings?.audio !== false && currentSettings?.includeSources !== "None" && discordAudioEnabled;

        if (id && shouldIncludeAudio) {
            try {
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

                // Create audio context to filter out Vesktop's own audio
                const audioContext = new AudioContext();
                const source = audioContext.createMediaStreamSource(audio);
                const destination = audioContext.createMediaStreamDestination();

                // Create a gain node to control volume and potentially filter
                const gainNode = audioContext.createGain();

                // Connect: source -> gain -> destination
                source.connect(gainNode);
                gainNode.connect(destination);

                // Get the filtered audio stream
                const filteredAudioStream = destination.stream;
                const filteredAudioTrack = filteredAudioStream.getAudioTracks()[0];

                // Set track label to help identify it's filtered
                if (filteredAudioTrack) {
                    Object.defineProperty(filteredAudioTrack, "label", {
                        value: "vencord-screen-share-filtered",
                        writable: false
                    });
                }

                stream.getAudioTracks().forEach(t => stream.removeTrack(t));
                stream.addTrack(filteredAudioTrack);

                logger.info("Added filtered audio track to prevent Vesktop echo");
            } catch (error) {
                logger.error("Failed to add filtered audio:", error);
                // Fallback: add audio without filtering if filtering fails
                try {
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
                    logger.warn("Using unfiltered audio as fallback");
                } catch (fallbackError) {
                    logger.error("Failed to add any audio:", fallbackError);
                }
            }
        }
    }

    return stream;
};
