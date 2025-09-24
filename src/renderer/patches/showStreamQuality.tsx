/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@vencord/types/webpack";

import { VesktopLogger } from "../logger";
import { addPatch } from "./shared";

const MediaEngineStore = findStoreLazy("MediaEngineStore");

// Our custom quality options (matching ScreenSharePicker)
const StreamResolutions = [
    { value: 480, label: "480p" },
    { value: 720, label: "720p" },
    { value: 1080, label: "1080p" },
    { value: 1440, label: "1440p" }
];

const StreamFps = [
    { value: 15, label: "15 FPS" },
    { value: 30, label: "30 FPS" },
    { value: 60, label: "60 FPS" }
];

addPatch({
    patches: [
        {
            // Show the stream quality button
            find: 'id:"stream-settings"',
            replacement: {
                match: /\.isPlatformEmbedded\?/,
                replace: ".isPlatformEmbedded||true?"
            }
        },
        {
            // Show the audio button by making P (audio support check) always true
            find: 'id:"stream-settings-audio-enable"',
            replacement: {
                match: /P\s*\?\s*\(/,
                replace: "true?("
            }
        },
        {
            // Patch the soundshare toggle callback to ensure proper state management
            find: "soundshareEnabled:!",
            replacement: {
                // eslint-disable-next-line no-useless-escape
                match: /soundshareEnabled:\!(\i)/,
                replace: "soundshareEnabled:$self.toggleSoundshareEnabled($1)"
            }
        },
        {
            // Replace Discord's quality options with our custom ones
            find: "stream-settings-resolution",
            group: true,
            replacement: [
                {
                    // Replace the resolution options (g.km)
                    // eslint-disable-next-line no-useless-escape
                    match: /(\i)\.km\.map/,
                    replace: "$self.getResolutions().map"
                },
                {
                    // Replace the FPS options (g.af)
                    // eslint-disable-next-line no-useless-escape
                    match: /(\i)\.af\.map/,
                    replace: "$self.getFps().map"
                },
                {
                    // Hook into the P callback to log and apply quality changes
                    // eslint-disable-next-line no-useless-escape
                    match: /(\i)\.useCallback\(\s*\((\i),(\i),(\i),(\i)\)\s*=>\s*\{/,
                    replace: "$1.useCallback(($2,$3,$4,$5)=>{$self.applyQuality($3,$4);"
                }
            ]
        }
    ],

    // Provide our custom resolution options
    getResolutions() {
        return StreamResolutions;
    },

    // Provide our custom FPS options
    getFps() {
        return StreamFps;
    },

    // Toggle soundshareEnabled state
    toggleSoundshareEnabled(currentSoundshareEnabled) {
        const newState = !currentSoundshareEnabled;
        VesktopLogger.log("Toggling soundshareEnabled from:", currentSoundshareEnabled, "to:", newState);

        // Update the global audio state for screenShareFixes (Linux only)
        try {
            // Dynamically import to avoid issues on non-Linux platforms
            import("./screenShareFixes")
                .then(({ setDiscordAudioEnabled }) => {
                    setDiscordAudioEnabled(newState);
                })
                .catch(() => {
                    // Ignore import errors on non-Linux platforms
                });
        } catch (error) {
            // Ignore errors
        }

        // Apply audio changes to existing stream
        setTimeout(() => {
            this.updateStreamAudio(newState);
        }, 100);

        return newState;
    },

    // Update audio tracks in existing stream
    updateStreamAudio(audioEnabled) {
        try {
            // Get the MediaEngine and find active stream connections
            const mediaEngine = MediaEngineStore?.getMediaEngine();
            if (!mediaEngine) {
                return;
            }

            // Find the current stream connection
            const streamConnection = [...mediaEngine.connections].find(
                conn => conn.streamUserId !== undefined && conn.input && conn.input.stream
            );

            if (!streamConnection) {
                return;
            }

            const currentStream = streamConnection.input.stream;

            if (audioEnabled) {
                // Add audio track if enabled and not already present
                const hasAudio = currentStream.getAudioTracks().length > 0;
                if (!hasAudio) {
                    this.addVenmicDirectly(currentStream, streamConnection);
                }
            } else {
                // Remove audio tracks if disabled
                const audioTracks = currentStream.getAudioTracks();
                if (audioTracks.length > 0) {
                    audioTracks.forEach(track => {
                        currentStream.removeTrack(track);
                        track.stop();
                    });
                }
            }
        } catch (error) {
            VesktopLogger.error("Error updating stream audio:", error);
        }
    },

    // Add venmic audio directly and force Discord to recognize it
    async addVenmicDirectly(stream, streamConnection) {
        try {
            // Get venmic audio device
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioDevice = devices.find(({ label }) => label === "vencord-screen-share");

            if (!audioDevice) {
                return;
            }

            // Get venmic audio stream
            const audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: { exact: audioDevice.deviceId },
                    autoGainControl: false,
                    echoCancellation: false,
                    noiseSuppression: false,
                    channelCount: 2,
                    sampleRate: 48000,
                    sampleSize: 16
                }
            });

            const audioTrack = audioStream.getAudioTracks()[0];
            if (!audioTrack) {
                return;
            }

            // Add the audio track to the stream
            stream.addTrack(audioTrack);

            // Update the stream in the connection
            if (streamConnection.input) {
                const videoTracks = stream.getVideoTracks();
                const newStream = new MediaStream([...videoTracks, audioTrack]);
                streamConnection.input.stream = newStream;

                // Force transport update to recognize the new audio
                if (streamConnection.setTransportOptions) {
                    streamConnection.setTransportOptions({});
                }

                // Force WebRTC renegotiation if peer connection exists
                if (streamConnection.pc) {
                    const { pc } = streamConnection;
                    const senders = pc.getSenders();
                    const audioSender = senders.find(s => s.track && s.track.kind === "audio");

                    if (audioSender) {
                        await audioSender.replaceTrack(audioTrack);
                    } else {
                        pc.addTrack(audioTrack, newStream);
                    }

                    // Trigger renegotiation
                    if (pc.createOffer) {
                        pc.createOffer()
                            .then(offer => pc.setLocalDescription(offer))
                            .catch(() => {}); // Ignore errors
                    }
                }
            }
        } catch (error) {
            VesktopLogger.error("Failed to add audio:", error);
        }
    },

    // Apply the selected quality to the stream
    applyQuality(resolution, frameRate) {
        VesktopLogger.log("Applying Stream Quality:", {
            resolution: resolution + "p",
            frameRate: frameRate + " fps"
        });

        // Apply constraints to the actual video track
        setTimeout(async () => {
            try {
                const height = Number(resolution);
                const width = Math.round(height * (16 / 9));
                const fps = Number(frameRate);

                // Get the MediaEngine and connections
                const mediaEngine = MediaEngineStore?.getMediaEngine();
                if (!mediaEngine) {
                    VesktopLogger.error("MediaEngine not found");
                    return;
                }

                // Find the user's stream connection
                const conn = [...mediaEngine.connections].find(connection => connection.streamUserId !== undefined);

                if (!conn) {
                    VesktopLogger.error("No streaming connection found");
                    return;
                }

                // Update the connection parameters
                if (conn.videoStreamParameters && conn.videoStreamParameters[0]) {
                    conn.videoStreamParameters[0].maxFrameRate = fps;
                    conn.videoStreamParameters[0].maxResolution = {
                        height: height,
                        width: width
                    };
                    VesktopLogger.log("Updated connection parameters");
                }

                // Get the actual stream from input (like ScreenSharePicker does)
                if (conn.input && conn.input.stream) {
                    const track = conn.input.stream.getVideoTracks()[0];

                    if (track) {
                        // Use less restrictive constraints to avoid OverconstrainedError
                        const constraints = {
                            frameRate: { ideal: fps },
                            width: { ideal: width },
                            height: { ideal: height }
                        };

                        // Check track capabilities first if available
                        if (track.getCapabilities) {
                            try {
                                const capabilities = track.getCapabilities();

                                // Only apply constraints within the track's capabilities
                                if (
                                    capabilities.width &&
                                    width >= capabilities.width.min &&
                                    width <= capabilities.width.max
                                ) {
                                    constraints.width = { ideal: width };
                                }
                                if (
                                    capabilities.height &&
                                    height >= capabilities.height.min &&
                                    height <= capabilities.height.max
                                ) {
                                    constraints.height = { ideal: height };
                                }
                                if (
                                    capabilities.frameRate &&
                                    fps >= capabilities.frameRate.min &&
                                    fps <= capabilities.frameRate.max
                                ) {
                                    constraints.frameRate = { ideal: fps };
                                }
                            } catch (capError) {
                                VesktopLogger.warn("Could not get track capabilities:", capError);
                            }
                        }

                        try {
                            await track.applyConstraints(constraints);
                            VesktopLogger.log("Applied constraints successfully. New settings:", track.getSettings());

                            // Force the connection to update with new parameters
                            if (conn.setTransportOptions) {
                                conn.setTransportOptions({});
                            }
                        } catch (e) {
                            VesktopLogger.error("Failed to apply constraints, continuing with current settings:", e);
                            // Don't throw - let the stream continue with current settings
                        }
                    }
                } else {
                    VesktopLogger.error("No input stream found on connection");
                }
            } catch (error) {
                VesktopLogger.error("Failed to apply quality:", error);
            }
        }, 100);

        return "";
    }
});
