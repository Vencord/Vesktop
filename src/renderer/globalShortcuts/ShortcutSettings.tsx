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
import { ACTION_DESCRIPTIONS, ShortcutAction } from "shared/utils/keybind";

import { acceleratorToDisplay, recordKeybind } from "./recordKeybind";

const cl = classNameFactory("vcd-shortcuts-");

const shortcutStatus = reactiveValue<boolean | number>(true);
onIpcCommand(IpcCommands.KEY_BINDS_SET_STATUS, status => (shortcutStatus.value = status));

const waylandKeyBinds = reactiveValue<KeyBind[]>([]);
onIpcCommand(IpcCommands.KEY_BINDS_WUPDATE, (binds: KeyBind[]) => (waylandKeyBinds.value = binds));
const isWayland = VesktopNative.wayland.isWayland();

export interface KeyBind {
    id: string;
    enabled: boolean;
    action: ShortcutAction;
    key: string;
}

function WaylandKeyBindDisplay({ keyBind }: { keyBind: KeyBind }) {
    const displayKey = acceleratorToDisplay(keyBind.key);

    return (
        <div className={cl("group", "wayland-group")}>
            <BaseText size="md" weight="medium">
                {ACTION_DESCRIPTIONS[keyBind.action] ?? keyBind.action}
            </BaseText>
            <BaseText size="md" className={cl("trigger")}>
                {displayKey || "No trigger set"}
            </BaseText>
        </div>
    );
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
    const displayKey = acceleratorToDisplay(keyBind.key);

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
                options={Object.entries(ACTION_DESCRIPTIONS).map(([action, label]) => ({ label, value: action }))}
                isSelected={o => o === keyBind.action}
                select={o => setKeyBind({ ...keyBind, action: o })}
                serialize={identity}
            />
            <div className={cl("recorder")} aria-labelledby={keyId}>
                <input
                    className={cl("record-input")}
                    type="text"
                    value={displayKey || "No Keybind Set"}
                    readOnly
                    disabled={!displayKey}
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
    const waylandBinds = waylandKeyBinds.use();

    const useWaylandBinds = isWayland && Settings.store.keyBinds !== undefined;
    const canConfigure = typeof shortcutsStatus === "number" && shortcutsStatus >= 2;

    return (
        <div className={cl("container")}>
            {shortcutsStatus === false && (
                <Card variant="danger">
                    <BaseText size="md" weight="medium">
                        Some of your keybinds failed to register.
                    </BaseText>
                </Card>
            )}

            {useWaylandBinds
                ? waylandBinds.map(keyBind => <WaylandKeyBindDisplay key={keyBind.id} keyBind={keyBind} />)
                : keyBinds.map((keyBind, index) => (
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

            {(!useWaylandBinds || canConfigure) && (
                <Button
                    onClick={() => {
                        if (canConfigure) {
                            VesktopNative.wayland.configureShortcuts();
                        } else if (isWayland) {
                            Settings.store.keyBinds = [];
                        } else {
                            setKeyBinds(binds => [
                                ...binds,
                                { action: "unassigned", key: "", enabled: true, id: crypto.randomUUID() }
                            ]);
                        }
                    }}
                >
                    {isWayland
                        ? canConfigure
                            ? "Configure Global Shortcuts"
                            : "Register Global Shortcuts"
                        : "Add a Keybind"}
                </Button>
            )}
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
