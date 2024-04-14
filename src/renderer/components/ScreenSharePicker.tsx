/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./screenSharePicker.css";

import { closeModal, Margins, Modals, ModalSize, openModal, useAwaiter } from "@vencord/types/utils";
import { findStoreLazy, onceReady } from "@vencord/types/webpack";
import {
    Button,
    Card,
    FluxDispatcher,
    Forms,
    Select,
    Switch,
    Text,
    UserStore,
    useState
} from "@vencord/types/webpack/common";
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
    contentHint?: string;
    workaround?: boolean;
    onlyDefaultSpeakers?: boolean;
}

export interface StreamPick extends StreamSettings {
    id: string;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

export let currentSettings: StreamSettings | null = null;

addPatch({
    patches: [
        {
            find: "this.localWant=",
            replacement: {
                match: /this.localWant=/,
                replace: "$self.patchStreamQuality(this);$&"
            }
        },
        {
            find: "x-google-max-bitrate",
            replacement: [
                {
                    // eslint-disable-next-line no-useless-escape
                    match: /"x-google-max-bitrate=".concat\(\i\)/,
                    replace: '"x-google-max-bitrate=".concat("80_000")'
                },
                {
                    match: /;level-asymmetry-allowed=1/,
                    replace: ";b=AS:800000;level-asymmetry-allowed=1"
                }
            ]
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
        if (opts?.encode) {
            Object.assign(opts.encode, {
                framerate,
                width,
                height,
                pixelCount: height * width
            });
        }
        Object.assign(opts.capture, {
            framerate,
            width,
            height,
            pixelCount: height * width
        });
    }
});

if (isLinux) {
    onceReady.then(() => {
        FluxDispatcher.subscribe("STREAM_CLOSE", ({ streamKey }: { streamKey: string }) => {
            const owner = streamKey.split(":").at(-1);

            if (owner !== UserStore.getCurrentUser().id) {
                return;
            }

            VesktopNative.virtmic.stop();
        });
    });
}

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
                                await VesktopNative.virtmic.startSystem(v.workaround);
                            } else {
                                await VesktopNative.virtmic.start([v.audioSource], v.workaround);
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
        <div className="vcd-screen-picker-settings-grid">
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
                                    <label
                                        className="vcd-screen-picker-radio"
                                        data-checked={settings.resolution === res}
                                    >
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
                    <div className="vcd-screen-picker-quality">
                        <section>
                            <Forms.FormTitle>Content Type</Forms.FormTitle>
                            <div>
                                <div className="vcd-screen-picker-radios">
                                    <label
                                        className="vcd-screen-picker-radio"
                                        data-checked={settings.contentHint === "motion"}
                                    >
                                        <Text variant="text-sm/bold">Prefer Smoothness</Text>
                                        <input
                                            type="radio"
                                            name="contenthint"
                                            value="motion"
                                            checked={settings.contentHint === "motion"}
                                            onChange={() => setSettings(s => ({ ...s, contentHint: "motion" }))}
                                        />
                                    </label>
                                    <label
                                        className="vcd-screen-picker-radio"
                                        data-checked={settings.contentHint === "detail"}
                                    >
                                        <Text variant="text-sm/bold">Prefer Clarity</Text>
                                        <input
                                            type="radio"
                                            name="contenthint"
                                            value="detail"
                                            checked={settings.contentHint === "detail"}
                                            onChange={() => setSettings(s => ({ ...s, contentHint: "detail" }))}
                                        />
                                    </label>
                                </div>
                                <div className="vcd-screen-picker-hint-description">
                                    <p>
                                        Choosing "Prefer Clarity" will result in a significantly lower framerate in
                                        exchange for a much sharper and clearer image.
                                    </p>
                                </div>
                            </div>
                        </section>
                    </div>
                </Card>
            </div>

            <div>
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
                        workaround={settings.workaround}
                        onlyDefaultSpeakers={settings.onlyDefaultSpeakers}
                        setAudioSource={source => setSettings(s => ({ ...s, audioSource: source }))}
                        setWorkaround={value => setSettings(s => ({ ...s, workaround: value }))}
                        setOnlyDefaultSpeakers={value => setSettings(s => ({ ...s, onlyDefaultSpeakers: value }))}
                    />
                )}
            </div>
        </div>
    );
}

function AudioSourcePickerLinux({
    audioSource,
    workaround,
    onlyDefaultSpeakers,
    setAudioSource,
    setWorkaround,
    setOnlyDefaultSpeakers
}: {
    audioSource?: string;
    workaround?: boolean;
    onlyDefaultSpeakers?: boolean;
    setAudioSource(s: string): void;
    setWorkaround(b: boolean): void;
    setOnlyDefaultSpeakers(b: boolean): void;
}) {
    const [sources, _, loading] = useAwaiter(() => VesktopNative.virtmic.list(), {
        fallbackValue: { ok: true, targets: [] }
    });
    const allSources = sources.ok ? ["None", "Entire System", ...sources.targets] : null;

    return (
        <>
            <Forms.FormTitle>Audio Settings</Forms.FormTitle>
            <Card className="vcd-screen-picker-card">
                {loading ? (
                    <Forms.FormTitle>Loading Audio Sources...</Forms.FormTitle>
                ) : (
                    <Forms.FormTitle>Audio Source</Forms.FormTitle>
                )}

                {!sources.ok &&
                    (sources.isGlibcxxToOld ? (
                        <Forms.FormText>
                            Failed to retrieve Audio Sources because your C++ library is too old to run venmic. If you
                            would like to stream with Audio, see{" "}
                            <a
                                href="https://gist.github.com/Vendicated/b655044ffbb16b2716095a448c6d827a"
                                target="_blank"
                            >
                                this guide
                            </a>
                        </Forms.FormText>
                    ) : (
                        <Forms.FormText>
                            Failed to retrieve Audio Sources. If you would like to stream with Audio, make sure you're
                            using Pipewire, not Pulseaudio
                        </Forms.FormText>
                    ))}

                {allSources && (
                    <Select
                        options={allSources.map(s => ({ label: s, value: s, default: s === "None" }))}
                        isSelected={s => s === audioSource}
                        select={setAudioSource}
                        serialize={String}
                    />
                )}

                <Forms.FormDivider className={Margins.top16 + " " + Margins.bottom16} />

                <Switch
                    onChange={setWorkaround}
                    value={workaround ?? false}
                    note={
                        <>
                            Work around an issue that causes the microphone to be shared instead of the correct audio.
                            Only enable if you're experiencing this issue.
                        </>
                    }
                >
                    Microphone Workaround
                </Switch>

                <Switch
                    hideBorder
                    onChange={setOnlyDefaultSpeakers}
                    disabled={audioSource !== "Entire System"}
                    value={onlyDefaultSpeakers ?? true}
                    note={
                        <>
                            When sharing entire desktop audio, only share apps that play to the default speakers and
                            ignore apps that play to other speakers or devices.
                        </>
                    }
                >
                    Only Default Speakers
                </Switch>
            </Card>
        </>
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
        contentHint: "motion",
        audio: true
    });

    return (
        <Modals.ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
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
                        try {
                            var conn = [...MediaEngineStore.getMediaEngine().connections].find(
                                connection => connection.streamUserId === UserStore.getCurrentUser().id
                            );
                        } catch {
                            console.log("No current stream.");
                        }
                        try {
                            if (conn) {
                                const track = conn.input.stream.getVideoTracks()[0];
                                const frameRate = Number(settings.fps);
                                const height = Number(settings.resolution);
                                const width = Math.round(height * (16 / 9));
                                var constraints = track.getConstraints();
                                const newConstraints = {
                                    ...constraints,
                                    frameRate,
                                    width: { min: 640, ideal: width, max: 2560 },
                                    height: { min: 480, ideal: height, max: 1440 },
                                    advanced: [{ width: width, height: height }],
                                    resizeMode: "none"
                                };
                                track.applyConstraints(newConstraints).then(() => {
                                    console.log("Applied constraints from ScreenSharePicker successfully.");
                                    console.log("New constraints:", track.getConstraints());
                                });

                                // changing stream quality description
                                conn.videoStreamParameters[0].maxFrameRate = Number(settings.fps);
                                conn.videoStreamParameters[0].maxResolution.height = Number(settings.resolution);
                                conn.videoStreamParameters[0].maxResolution.width = Math.round(height * (16 / 9));
                            }
                        } catch {
                            console.log("No current stream.");
                        }
                        try {
                            submit({
                                id: selected!,
                                ...settings
                            });

                            // reapply contraints after some time to let discord resubmit stream
                            // i believe there MUST be way to do it cleaner..
                            if (conn) {
                                setTimeout(() => {
                                    const track = conn.input.stream.getVideoTracks()[0];
                                    const frameRate = Number(settings.fps);
                                    const height = Number(settings.resolution);
                                    const width = Math.round(height * (16 / 9));
                                    var constraints = track.getConstraints();
                                    const newConstraints = {
                                        ...constraints,
                                        frameRate,
                                        width: { min: 640, ideal: width, max: 2560 },
                                        height: { min: 480, ideal: height, max: 1440 },
                                        advanced: [{ width: width, height: height }],
                                        resizeMode: "none"
                                    };
                                    track.applyConstraints(newConstraints).then(() => {
                                        console.log("Applied constraints from ScreenSharePicker successfully.");
                                        console.log("New constraints:", track.getConstraints());
                                    });

                                    // changing stream quality description
                                    conn.videoStreamParameters[0].maxFrameRate = Number(settings.fps);
                                    conn.videoStreamParameters[0].maxResolution.height = Number(settings.resolution);
                                    conn.videoStreamParameters[0].maxResolution.width = Math.round(height * (16 / 9));
                                }, 100);
                            }
                        } catch {
                            console.log("Unable to start stream.");
                        }

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
