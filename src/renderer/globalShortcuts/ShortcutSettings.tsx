/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./ShortcutSettings.css";
import {
    Button,
    Card,
    CodeBlock,
    DeleteIcon,
    Divider,
    FormSwitch,
    HeadingSecondary,
    HeadingTertiary,
    InlineCode,
    Paragraph,
    Switch,
    Text
} from "@vencord/types/components";
import { classNameFactory, identity } from "@vencord/types/utils";
import { Modal, openModal, React, Select, useEffect, useState } from "@vencord/types/webpack/common";
import { SettingsComponent } from "renderer/components/settings/Settings";
import { onIpcCommand } from "renderer/ipcCommands";
import { reactiveValue } from "renderer/reactiveState";
import { useSettings } from "renderer/settings";
import { IpcCommands } from "shared/IpcEvents";
import { ACTION_DESCRIPTIONS, KeyBind, KeybindStatus } from "shared/utils/keybind";

import { keysToDisplay, loadKeyboardLayout, recordKeybind } from "./recordKeybind";

const cl = classNameFactory("vcd-shortcuts-");

const keybindStatus = reactiveValue<KeybindStatus | null>(null);
onIpcCommand(IpcCommands.KEYBINDS_STATUS, (status: KeybindStatus) => (keybindStatus.value = status));

const ACTION_OPTIONS = [
    { label: "Unassigned", value: "unassigned" },
    ...Object.entries(ACTION_DESCRIPTIONS).map(([value, label]) => ({ label, value }))
];

function ErrorCard({ children, onRetry }: { children: React.ReactNode; onRetry?(): void }) {
    return (
        <Card variant="danger" className={cl("card")}>
            <Text size="md">{children}</Text>
            {onRetry && (
                <Button size="small" variant="secondary" onClick={onRetry}>
                    Retry
                </Button>
            )}
        </Card>
    );
}

function KeybindRecorder({ keys, onChange }: { keys: string[]; onChange(keys: string[]): void }) {
    const [controller, setController] = useState<AbortController | null>(null);

    // Stop listening for input if the modal is closed while recording
    useEffect(() => () => controller?.abort(), [controller]);

    async function toggleRecording() {
        if (controller) return controller.abort();

        const newController = new AbortController();
        setController(newController);
        try {
            onChange(await recordKeybind(newController.signal));
        } catch {
            // aborted
        } finally {
            setController(null);
        }
    }

    const display = keys.length ? keysToDisplay(keys) : "No Keybind Set";

    return (
        <div className={cl("recorder")}>
            <Text size="md" weight={keys.length ? "semibold" : "normal"} className={cl("recorder-keys")}>
                {controller ? "Press keys or mouse buttons..." : display}
            </Text>
            <Button size="small" variant="secondary" onClick={toggleRecording}>
                {controller ? "Cancel" : "Record"}
            </Button>
        </div>
    );
}

function KeybindRow({
    keybind,
    onChange,
    onDelete
}: {
    keybind: KeyBind;
    onChange(keybind: KeyBind): void;
    onDelete(): void;
}) {
    return (
        <div className={cl("row")}>
            <Select
                options={ACTION_OPTIONS}
                isSelected={v => v === keybind.action}
                select={action => onChange({ ...keybind, action })}
                serialize={identity}
            />
            <KeybindRecorder keys={keybind.keys} onChange={keys => onChange({ ...keybind, keys })} />
            <Button size="iconOnly" variant="secondary" aria-label="Delete Keybind" onClick={onDelete}>
                <DeleteIcon />
            </Button>
            <Switch checked={keybind.enabled} onChange={enabled => onChange({ ...keybind, enabled })} />
        </div>
    );
}

function HookKeybinds({ status }: { status: KeybindStatus }) {
    const settings = useSettings();
    const keybinds = settings.keyBinds ?? [];

    const setKeybinds = (newKeybinds: KeyBind[]) => (settings.keyBinds = newKeybinds);

    return (
        <>
            {status.needsPermission && (
                <Card variant="warning" className={cl("card")}>
                    <Text size="md">
                        Vesktop needs the Accessibility permission to detect your keybinds while it is not focused.
                    </Text>
                    <Button size="small" onClick={() => VesktopNative.keybinds.requestPermission()}>
                        Grant Permission
                    </Button>
                </Card>
            )}
            {status.error && <ErrorCard onRetry={() => VesktopNative.keybinds.retry()}>{status.error}</ErrorCard>}

            {keybinds.map((keybind, i) => (
                <KeybindRow
                    key={keybind.id}
                    keybind={keybind}
                    onChange={newKeybind => setKeybinds(keybinds.with(i, newKeybind))}
                    onDelete={() => setKeybinds(keybinds.toSpliced(i, 1))}
                />
            ))}

            <Button
                onClick={() =>
                    setKeybinds([
                        ...keybinds,
                        { id: crypto.randomUUID(), action: "unassigned", keys: [], enabled: true }
                    ])
                }
            >
                Add Keybind
            </Button>
        </>
    );
}

// Portals describe triggers in their own format, e.g. GNOME uses "Press <Control><Shift>p"
function formatPortalTrigger(trigger: string) {
    const match = /^(?:Press )?((?:<\w+>)+)(.+)$/.exec(trigger);
    if (!match) return trigger;

    const modifiers = match[1].slice(1, -1).split("><");
    const key = match[2].length === 1 ? match[2].toUpperCase() : match[2];
    return [...modifiers.map(m => (m === "Control" ? "Ctrl" : m)), key].join(" + ");
}

function PortalKeybinds({ status }: { status: KeybindStatus }) {
    const settings = useSettings();
    const { portalState, portalShortcuts = [], portalConfigurable } = status;

    return (
        <>
            <FormSwitch
                title="Enable global shortcuts"
                description="Registers Vesktop's actions with your desktop environment, which lets you assign shortcuts to them. Your system may ask you to set them up."
                value={!!settings.globalShortcutsPortal}
                onChange={v => (settings.globalShortcutsPortal = v)}
                hideBorder
            />

            {portalState === "connecting" && <Text size="md">Connecting to your desktop environment...</Text>}

            {portalState === "unavailable" && (
                <ErrorCard onRetry={() => VesktopNative.keybinds.retry()}>
                    Your desktop environment does not support global shortcuts. You can still bind actions with your
                    compositor's keybinds instead, see below.
                    {status.error && ` (${status.error})`}
                </ErrorCard>
            )}

            {portalState === "ready" && (
                <>
                    {status.error && <ErrorCard>{status.error}</ErrorCard>}

                    <Table columns={["Action", "Shortcut"]}>
                        {portalShortcuts.map(({ id, description, trigger }) => (
                            <tr key={id}>
                                <Cell>{description}</Cell>
                                <Cell>
                                    {trigger ? (
                                        <InlineCode>{formatPortalTrigger(trigger)}</InlineCode>
                                    ) : (
                                        <span className={cl("muted")}>Not assigned</span>
                                    )}
                                </Cell>
                            </tr>
                        ))}
                    </Table>

                    {portalConfigurable ? (
                        <Button onClick={() => VesktopNative.keybinds.configurePortal()}>Change Shortcuts</Button>
                    ) : (
                        <Paragraph size="md">You can change these shortcuts in your system settings.</Paragraph>
                    )}
                </>
            )}
        </>
    );
}

function Table({ columns, children }: { columns: string[]; children: React.ReactNode }) {
    return (
        <table className={cl("table")}>
            <thead>
                <tr>
                    {columns.map(c => (
                        <th key={c}>
                            <Text size="xs" weight="semibold" className={cl("muted")}>
                                {c}
                            </Text>
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    );
}

function Cell({ children }: { children: React.ReactNode }) {
    return (
        <td>
            <Text size="md">{children}</Text>
        </td>
    );
}

function ExternalTriggers() {
    const socketPath = VesktopNative.keybinds.getSocketPath();

    return (
        <section className={cl("external")}>
            <HeadingSecondary>Triggering actions from other programs</HeadingSecondary>
            <Paragraph size="md">
                Useful for scripts or your compositor's keybinds. Add <InlineCode>:down</InlineCode> or{" "}
                <InlineCode>:up</InlineCode> to only press or release an action, for example to bind push to talk to a
                key press and its release.
            </Paragraph>

            <div className={cl("external-section")}>
                <HeadingTertiary>Command Line</HeadingTertiary>
                <CodeBlock
                    lang="sh"
                    content={[
                        "vesktop --run-shortcut toggleMute",
                        "vesktop --run-shortcut pushToTalk:down",
                        "vesktop --run-shortcut pushToTalk:up"
                    ].join("\n")}
                />
            </div>

            <div className={cl("external-section")}>
                <HeadingTertiary>Socket</HeadingTertiary>
                <Paragraph size="md">
                    Faster than the command line. Send one command per line to <InlineCode>{socketPath}</InlineCode>
                </Paragraph>
                <CodeBlock lang="sh" content={`echo "run-shortcut toggleMute" | socat - UNIX-CONNECT:${socketPath}`} />
            </div>

            <div className={cl("external-section")}>
                <HeadingTertiary>Actions</HeadingTertiary>
                <Table columns={["Name", "Action"]}>
                    {Object.entries(ACTION_DESCRIPTIONS).map(([name, description]) => (
                        <tr key={name}>
                            <Cell>
                                <InlineCode>{name}</InlineCode>
                            </Cell>
                            <Cell>{description}</Cell>
                        </tr>
                    ))}
                </Table>
            </div>
        </section>
    );
}

function KeybindSettings() {
    const status = keybindStatus.use();

    useEffect(() => {
        VesktopNative.keybinds.getStatus().then(s => (keybindStatus.value = s));
    }, []);

    if (!status) return null;

    return (
        <div className={cl("container")}>
            {status.backend === "portal" ? <PortalKeybinds status={status} /> : <HookKeybinds status={status} />}
            <Divider />
            <ExternalTriggers />
        </div>
    );
}

export async function openKeybindsModal() {
    await loadKeyboardLayout().catch(e => console.error("Failed to get keyboard layout", e));

    openModal(props => (
        <Modal {...props} size="xl" title="Global Keybinds">
            <KeybindSettings />
        </Modal>
    ));
}

export const KeybindsButton: SettingsComponent = () => (
    <Button onClick={() => openKeybindsModal()}>Configure Global Keybinds</Button>
);
