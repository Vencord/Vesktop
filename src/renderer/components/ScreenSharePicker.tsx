/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./screenSharePicker.css";

import { closeModal, Modals, openModal, useAwaiter } from "@vencord/types/utils";
import { findStoreLazy } from "@vencord/types/webpack";
import { Button, Card, Forms, Select, Switch, Text, useState } from "@vencord/types/webpack/common";
import type { Dispatch, SetStateAction } from "react";
import { addPatch } from "renderer/patches/shared";
import { isLinux, isWindows } from "renderer/utils";

const StreamResolutions = ["480", "720", "1080", "1440"] as const;
const StreamFps = ["15", "30", "60"] as const;

const MediaEngineStore = findStoreLazy("MediaEngineStore");

export type StreamResolution = (typeof StreamResolutions)[number];
export type StreamFps = (typeof StreamFps)[number];

interface StreamSettings {
    resolution: StreamResolution;
    fps: StreamFps;
    audio: boolean;
    audioSource?: string;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

let currentSettings: StreamSettings | null = null;

addPatch({
    patches: [
        {
            find: "this.localWant=",
            replacement: {
                match: /this.localWant=/,
                replace: "$self.patchStreamQuality(this);$&"
            }
        }
    ],
    patchStreamQuality(opts: any) {
        if (!currentSettings) return;

        const framerate = Number(currentSettings.fps);
        const height = Number(currentSettings.resolution);
        const width = Math.round(height * (16 / 9));

        Object.assign(opts, {
            bitrateMin: 500000,
            bitrateMax: 8000000,
            bitrateTarget: 600000
        });
        Object.assign(opts.capture, {
            framerate,
            width,
            height,
            pixelCount: height * width
        });
    }
});

export function openScreenSharePicker(screens: Source[], skipPicker: boolean) {
    let didSubmit = false;
    return new Promise<StreamPick>((resolve, reject) => {
        const key = openModal(
            props => (
                <ModalComponent
                    screens={screens}
                    modalProps={props}
                    submit={async v => {
                        didSubmit = true;
                        if (v.audioSource && v.audioSource !== "None") {
                            if (v.audioSource === "Entire System") {
                                await VesktopNative.virtmic.start("Chromium", "exclude");
                            } else {
                                await VesktopNative.virtmic.start(v.audioSource, "include");
                            }
                        }
                        resolve(v);
                    }}
                    close={() => {
                        props.onClose();
                        if (!didSubmit) reject("Aborted");
                    }}
                    skipPicker={skipPicker}
                />
            ),
            {
                onCloseRequest() {
                    closeModal(key);
                    reject("Aborted");
                }
            }
        );
    });
}

function ScreenPicker({ screens, chooseScreen }: { screens: Source[]; chooseScreen: (id: string) => void }) {
    return (
        <div className="vcd-screen-picker-grid">
            {screens.map(({ id, name, url }) => (
                <label key={id}>
                    <input type="radio" name="screen" value={id} onChange={() => chooseScreen(id)} />

                    <img src={url} alt="" />
                    <Text variant="text-sm/normal">{name}</Text>
                </label>
            ))}
        </div>
    );
}

function StreamSettings({
    source,
    settings,
    setSettings,
    skipPicker
}: {
    source: Source;
    settings: StreamSettings;
    setSettings: Dispatch<SetStateAction<StreamSettings>>;
    skipPicker: boolean;
}) {
    const [thumb] = useAwaiter(
        () => (skipPicker ? Promise.resolve(source.url) : VesktopNative.capturer.getLargeThumbnail(source.id)),
        {
            fallbackValue: source.url,
            deps: [source.id]
        }
    );

    return (
        <div>
            <Forms.FormTitle>What you're streaming</Forms.FormTitle>
            <Card className="vcd-screen-picker-card vcd-screen-picker-preview">
                <img src={thumb} alt="" />
                <Text variant="text-sm/normal">{source.name}</Text>
            </Card>

            <Forms.FormTitle>Stream Settings</Forms.FormTitle>

            <Card className="vcd-screen-picker-card">
                <div className="vcd-screen-picker-quality">
                    <section>
                        <Forms.FormTitle>Resolution</Forms.FormTitle>
                        <div className="vcd-screen-picker-radios">
                            {StreamResolutions.map(res => (
                                <label className="vcd-screen-picker-radio" data-checked={settings.resolution === res}>
                                    <Text variant="text-sm/bold">{res}</Text>
                                    <input
                                        type="radio"
                                        name="resolution"
                                        value={res}
                                        checked={settings.resolution === res}
                                        onChange={() => setSettings(s => ({ ...s, resolution: res }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>

                    <section>
                        <Forms.FormTitle>Frame Rate</Forms.FormTitle>
                        <div className="vcd-screen-picker-radios">
                            {StreamFps.map(fps => (
                                <label className="vcd-screen-picker-radio" data-checked={settings.fps === fps}>
                                    <Text variant="text-sm/bold">{fps}</Text>
                                    <input
                                        type="radio"
                                        name="fps"
                                        value={fps}
                                        checked={settings.fps === fps}
                                        onChange={() => setSettings(s => ({ ...s, fps }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </section>
                </div>

                {isWindows && (
                    <Switch
                        value={settings.audio}
                        onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                        hideBorder
                        className="vcd-screen-picker-audio"
                    >
                        Stream With Audio
                    </Switch>
                )}

                {isLinux && (
                    <AudioSourcePickerLinux
                        audioSource={settings.audioSource}
                        setAudioSource={source => setSettings(s => ({ ...s, audioSource: source }))}
                    />
                )}
            </Card>
        </div>
    );
}

function AudioSourcePickerLinux({
    audioSource,
    setAudioSource
}: {
    audioSource?: string;
    setAudioSource(s: string): void;
}) {
    const [sources, _, loading] = useAwaiter(() => VesktopNative.virtmic.list(), { fallbackValue: [] });
    const allSources = sources ? ["None", "Entire System", ...sources] : null;

    return (
        <section>
            <Forms.FormTitle>Audio</Forms.FormTitle>
            {loading && <Forms.FormTitle>Loading Audio sources...</Forms.FormTitle>}
            {allSources === null && (
                <Forms.FormTitle>
                    Failed to retrieve Audio Sources. If you would like to stream with Audio, make sure you're using
                    Pipewire, not Pulseaudio
                </Forms.FormTitle>
            )}

            {allSources && (
                <Select
                    options={allSources.map(s => ({ label: s, value: s, default: s === "None" }))}
                    isSelected={s => s === audioSource}
                    select={setAudioSource}
                    serialize={String}
                />
            )}
        </section>
    );
}

function ModalComponent({
    screens,
    modalProps,
    submit,
    close,
    skipPicker
}: {
    screens: Source[];
    modalProps: any;
    submit: (data: StreamPick) => void;
    close: () => void;
    skipPicker: boolean;
}) {
    const [selected, setSelected] = useState<string | undefined>(skipPicker ? screens[0].id : void 0);
    const [settings, setSettings] = useState<StreamSettings>({
        resolution: "1080",
        fps: "60",
        audio: true
    });

    return (
        <Modals.ModalRoot {...modalProps}>
            <Modals.ModalHeader className="vcd-screen-picker-header">
                <Forms.FormTitle tag="h2">ScreenShare</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>

            <Modals.ModalContent className="vcd-screen-picker-modal">
                {!selected ? (
                    <ScreenPicker screens={screens} chooseScreen={setSelected} />
                ) : (
                    <StreamSettings
                        source={screens.find(s => s.id === selected)!}
                        settings={settings}
                        setSettings={setSettings}
                        skipPicker={skipPicker}
                    />
                )}
            </Modals.ModalContent>

            <Modals.ModalFooter className="vcd-screen-picker-footer">
                <Button
                    disabled={!selected}
                    onClick={() => {
                        currentSettings = settings;

                        // If there are 2 connections, the second one is the existing stream.
                        // In that case, we patch its quality
                        const conn = [...MediaEngineStore.getMediaEngine().connections][1];
                        if (conn && conn.videoStreamParameters.length > 0) {
                            const height = Number(settings.resolution);
                            const width = Math.round(height * (16 / 9));
                            Object.assign(conn.videoStreamParameters[0], {
                                maxFrameRate: Number(settings.fps),
                                maxPixelCount: width * height,
                                maxBitrate: 8000000,
                                maxResolution: {
                                    type: "fixed",
                                    width,
                                    height
                                }
                            });
                        }

                        submit({
                            id: selected!,
                            ...settings
                        });

                        close();
                    }}
                >
                    Go Live
                </Button>

                {selected && !skipPicker ? (
                    <Button color={Button.Colors.TRANSPARENT} onClick={() => setSelected(void 0)}>
                        Back
                    </Button>
                ) : (
                    <Button color={Button.Colors.TRANSPARENT} onClick={close}>
                        Cancel
                    </Button>
                )}
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}
