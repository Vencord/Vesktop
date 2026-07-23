/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ShortcutSettings.css";

import { BaseText, Button, Card, DeleteIcon, Switch } from "@vencord/types/components";
import {
    classNameFactory,
    identity,
    ModalCloseButton,
    ModalContent,
    ModalHeader,
    ModalRoot,
    ModalSize,
    openModal
} from "@vencord/types/utils";
import { React, Select, useState } from "@vencord/types/webpack/common";
import { SettingsComponent } from "renderer/components/settings/Settings";
import { onIpcCommand } from "renderer/ipcCommands";
import { reactiveValue } from "renderer/reactiveState";
import { Settings } from "renderer/settings";
import { IpcCommands } from "shared/IpcEvents";

import { recordKeybind } from "./recordKeybind";

const cl = classNameFactory("vcd-shortcuts-");

const ShortcutActions = {
    unassigned: "Unassigned",
    mute: "Mute",
    unmute: "Unmute",
    toggleMute: "Toggle Mute",
    toggleDeafen: "Toggle Deafen",
    toggleStreamerMode: "Toggle Streamer Mode",
    pushToTalkNormalToggle: "Push-to-Talk (Normal) Toggle",
    pushToTalkNormalStart: "Push-to-Talk (Normal) Start",
    pushToTalkNormalStop: "Push-to-Talk (Normal) Stop",
    pushToTalkPriorityToggle: "Push-to-Talk (Priority) Toggle",
    pushToTalkPriorityStart: "Push-to-Talk (Priority) Start",
    pushToTalkPriorityStop: "Push-to-Talk (Priority) Stop",
    disconnectFromVoiceChannel: "Disconnect from VC"
} as const;

export type ShortcutAction = keyof typeof ShortcutActions;

const shortcutStatus = reactiveValue(true);
onIpcCommand(IpcCommands.KEY_BINDS_SET_STATUS, status => (shortcutStatus.value = status));

export interface KeyBind {
    id: string;
    enabled: boolean;
    action: ShortcutAction;
    key: string;
}

function KeyBindGroup({
    keyBind,
    setKeyBind,
    deleteKeyBind
}: {
    keyBind: KeyBind;
    setKeyBind(keyBind: KeyBind): void;
    deleteKeyBind(): void;
}) {
    const [isRecording, setIsRecording] = useState(false);
    const [abortController, setAbortController] = useState<AbortController | null>(null);

    const actionId = React.useId();
    const keyId = React.useId();

    return (
        <div className={cl("group")}>
            <BaseText size="md" weight="medium" className={cl("label")} id={actionId}>
                Action
            </BaseText>
            <BaseText size="md" weight="medium" className={cl("label")} id={keyId}>
                Keybind
            </BaseText>

            {/* @ts-expect-error incorrect type for aria-labelledby */}
            <Select
                aria-labelledby={actionId}
                options={Object.entries(ShortcutActions).map(([action, label]) => ({ label, value: action }))}
                isSelected={o => o === keyBind.action}
                select={o => setKeyBind({ ...keyBind, action: o })}
                serialize={identity}
            />
            <div className={cl("recorder")} aria-labelledby={keyId}>
                <input
                    className={cl("record-input")}
                    type="text"
                    value={keyBind.key || "No Keybind Set"}
                    readOnly
                    disabled={!keyBind.key}
                />
                <Button
                    className="record-button"
                    variant="secondary"
                    size="small"
                    onClick={async () => {
                        if (isRecording) {
                            abortController?.abort();
                            setIsRecording(false);
                            setAbortController(null);
                        } else {
                            const controller = new AbortController();
                            setAbortController(controller);
                            setIsRecording(true);
                            const key = await recordKeybind(controller.signal).catch(() => null);
                            setIsRecording(false);
                            setAbortController(null);
                            if (key) setKeyBind({ ...keyBind, key });
                        }
                    }}
                >
                    {isRecording ? "Cancel Recording" : "Record"}
                </Button>
            </div>

            <Button size="iconOnly" variant="secondary" aria-label="Delete Keybind" onClick={deleteKeyBind}>
                <DeleteIcon />
            </Button>

            <Switch checked={keyBind.enabled} onChange={v => setKeyBind({ ...keyBind, enabled: v })} />
        </div>
    );
}

export function KeyBindSettings() {
    const [keyBinds, setKeyBinds] = useState<KeyBind[]>(Settings.store.keyBinds ?? []);
    const shortcutsStatus = shortcutStatus.use();

    return (
        <div className={cl("container")}>
            {shortcutsStatus === false && (
                <Card variant="danger">
                    <BaseText size="md" weight="medium">
                        Some of your keybinds failed to register.
                    </BaseText>
                </Card>
            )}

            {keyBinds.map((keyBind, index) => (
                <KeyBindGroup
                    key={keyBind.id}
                    keyBind={keyBind}
                    setKeyBind={newKeyBind => {
                        const newKeyBinds = [...keyBinds];
                        newKeyBinds[index] = newKeyBind;
                        setKeyBinds(newKeyBinds);
                        Settings.store.keyBinds = newKeyBinds;
                    }}
                    deleteKeyBind={() => {
                        const newKeyBinds = keyBinds.filter((_, i) => i !== index);
                        setKeyBinds(newKeyBinds);
                        Settings.store.keyBinds = newKeyBinds;
                    }}
                />
            ))}
            <Button
                onClick={() => {
                    setKeyBinds(binds => [
                        ...binds,
                        {
                            action: "unassigned",
                            key: "",
                            enabled: true,
                            id: crypto.randomUUID()
                        }
                    ]);
                }}
            >
                Add a Keybind
            </Button>
        </div>
    );
}

export function openKeybindsModal() {
    openModal(props => (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <BaseText size="lg" weight="semibold" tag="h3" style={{ flexGrow: 1 }}>
                    Keybinds
                </BaseText>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>

            <ModalContent>
                <KeyBindSettings />
            </ModalContent>
        </ModalRoot>
    ));
}

export const KeybindsButton: SettingsComponent = () => {
    return <Button onClick={() => openKeybindsModal()}>Configure Keybinds</Button>;
};
