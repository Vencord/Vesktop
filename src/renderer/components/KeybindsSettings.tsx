/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Flex } from "@vencord/types/components";
import { Button, Card, Heading, Select, TextInput, useEffect, useRef, useState } from "@vencord/types/webpack/common";
import { actionReadableNames, registerKeybinds, unregisterKeybinds } from "renderer/keybinds";
import { State } from "renderer/settings";

export function KeybindsSettingsPage() {
    const [keybinds, setKeybinds] = useState(State.store.keybinds || []);
    useEffect(() => {
        unregisterKeybinds();
        return () => {
            State.store.keybinds = keybinds.filter(x => x.action !== "");
            registerKeybinds();
        };
    }, []);
    return (
        <Flex flexDirection="column" style={{ gap: "2px" }}>
            <Button
                style={{
                    alignSelf: "flex-end",
                    marginBottom: "1em"
                }}
                onClick={() =>
                    setKeybinds(keybinds => [
                        ...keybinds,
                        {
                            action: "",
                            shortcut: ""
                        }
                    ])
                }
            >
                New Keybind
            </Button>
            {keybinds.map((x, i) => (
                <KeybindCard action={x.action} index={i} setKeybinds={setKeybinds} shortcut={x.shortcut} />
            ))}
        </Flex>
    );
}
function KeybindCard({ setKeybinds, index, action, shortcut }) {
    const shortcutTextInput = useRef<HTMLInputElement>(null);
    const [recording, setRecording] = useState(false);
    useEffect(() => {
        if (recording) shortcutTextInput.current?.focus();
    }, [recording]);
    return (
        <Card
            type={Card.Types.PRIMARY}
            style={{
                padding: "12px"
            }}
        >
            <Flex flexDirection="column" style={{ gap: 0 }}>
                <Button
                    color={Button.Colors.RED}
                    style={{
                        borderRadius: "50%",
                        width: "24px",
                        height: "24px",
                        backgroundImage: "url(/assets/cc9937ea92f932c3.svg)",
                        backgroundPosition: "50% 50%",
                        backgroundRepeat: "no-repeat",
                        alignSelf: "flex-end"
                    }}
                    size={Button.Sizes.ICON}
                    onClick={() => {
                        setKeybinds(keybinds => keybinds.filter((_, i) => i !== index));
                    }}
                />
                <Flex>
                    <Flex flexDirection="column" style={{ flexGrow: 1 }}>
                        <Heading variant="heading-md/semibold">Action</Heading>
                        <Select
                            options={Object.entries(actionReadableNames).map(a => ({
                                value: a[0],
                                label: a[1]
                            }))}
                            placeholder="Unassigned"
                            select={v => {
                                setKeybinds(keybinds => {
                                    keybinds[index].action = v;
                                    return [...keybinds];
                                });
                            }}
                            isSelected={v => v === action}
                            serialize={v => String(v)}
                        />
                    </Flex>
                    <Flex flexDirection="column" style={{ flexGrow: 1 }}>
                        <Heading variant="heading-md/semibold">Keybind</Heading>
                        <Flex style={{ gap: 0 }} flexDirection="row">
                            <div style={{ flexGrow: 2 }}>
                                <TextInput
                                    editable={recording}
                                    placeholder="No keybind set"
                                    value={shortcut}
                                    inputRef={shortcutTextInput}
                                    onBlur={() => setRecording(false)}
                                    onKeyDown={() => {
                                        setKeybinds(keybinds => {
                                            keybinds[index].shortcut = VesktopNative.keybind.getCurrentShortcut();
                                            return [...keybinds];
                                        });
                                    }}
                                />
                            </div>
                            <Button
                                size={Button.Sizes.LARGE}
                                color={Button.Colors.TRANSPARENT}
                                style={{ flexGrow: 1, width: "auto" }}
                                onClick={() => setRecording(!recording)}
                            >
                                Edit Keybind
                            </Button>
                        </Flex>
                    </Flex>
                </Flex>
            </Flex>
        </Card>
    );
}
