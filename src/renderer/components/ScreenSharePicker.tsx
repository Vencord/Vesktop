/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./screenSharePicker.css";

import { Modals, openModal } from "@vencord/types/utils";
import { Button, Card, Forms, Switch, Text, useState } from "@vencord/types/webpack/common";
import { Dispatch, SetStateAction } from "react";

const StreamResolutions = ["720", "1080", "1440", "Source"] as const;
const StreamFps = ["15", "30", "60"] as const;

export type StreamResolution = (typeof StreamResolutions)[number];
export type StreamFps = (typeof StreamFps)[number];

interface StreamSettings {
    resolution: StreamResolution;
    fps: StreamFps;
    audio: boolean;
}

interface Source {
    id: string;
    name: string;
    url: string;
}

export function openScreenSharePicker(screens: Source[]) {
    return new Promise<string>((resolve, reject) => {
        openModal(props => (
            <ModalComponent
                screens={screens}
                modalProps={props}
                submit={resolve}
                close={() => {
                    props.onClose();
                    reject(new Error("Aborted"));
                }}
            />
        ));
    });
}

function ScreenPicker({ screens, onPick }: { screens: Source[]; onPick: (id: string) => void; }) {
    return (
        <div className="vcd-screen-picker-grid">
            {screens.map(({ id, name, url }) => (
                <label key={id}>
                    <input type="radio" name="screen" value={id} onChange={() => onPick(id)} />

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
    setSettings
}: {
    source: Source;
    settings: StreamSettings;
    setSettings: Dispatch<SetStateAction<StreamSettings>>;
}) {
    return (
        <div>
            <Forms.FormTitle>What you're streaming</Forms.FormTitle>
            <Card className="vcd-screen-picker-card vcd-screen-picker-preview">
                <img src={source.url} alt="" />
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
                                    <Forms.FormTitle>{res}</Forms.FormTitle>
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
                                    <Forms.FormTitle>{fps}</Forms.FormTitle>
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

                <Switch
                    value={settings.audio}
                    onChange={checked => setSettings(s => ({ ...s, audio: checked }))}
                    hideBorder
                    className="vcd-screen-picker-audio"
                >
                    Stream With Audio
                </Switch>
            </Card>
        </div>
    );
}

function ModalComponent({
    screens,
    modalProps,
    submit,
    close
}: {
    screens: Source[];
    modalProps: any;
    submit: (id: string) => void;
    close: () => void;
}) {
    const [selected, setSelected] = useState<string>();
    const [settings, setSettings] = useState<StreamSettings>({
        resolution: "1080",
        fps: "60",
        audio: true
    });

    return (
        <Modals.ModalRoot {...modalProps}>
            <Modals.ModalHeader>
                <Forms.FormTitle tag="h2">Screen Picker</Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>

            <Modals.ModalContent className="vcd-screen-picker-modal">
                {!selected ? (
                    <ScreenPicker screens={screens} onPick={setSelected} />
                ) : (
                    <StreamSettings
                        source={screens.find(s => s.id === selected)!}
                        settings={settings}
                        setSettings={setSettings}
                    />
                )}
            </Modals.ModalContent>

            <Modals.ModalFooter>
                <Button
                    disabled={!selected}
                    onClick={() => {
                        submit(selected!);
                        close();
                    }}
                >
                    Go Live
                </Button>

                {selected ? (
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
