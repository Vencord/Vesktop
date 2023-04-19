/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./settings.css";

import { Margins } from "@vencord/types/utils";
import { Button, Forms, Select, Switch, Text } from "@vencord/types/webpack/common";
import { useSettings } from "renderer/settings";

export default function SettingsUi() {
    const Settings = useSettings();

    const switches: [keyof typeof Settings, string, string, boolean?, (() => boolean)?][] = [
        ["tray", "Tray Icon", "Add a tray icon for Vencord Desktop", true],
        [
            "minimizeToTray",
            "Minimize to tray",
            "Hitting X will make Vencord Desktop minimize to the tray instead of closing",
            true,
            () => Settings.tray ?? true
        ],
        [
            "disableMinSize",
            "Disable minimum window size",
            "Allows you to make the window as small as your heart desires"
        ],
        [
            "openLinksWithElectron",
            "Open Links in app (experimental)",
            "Opens links in a new Vencord Desktop window instead of your web browser"
        ]
    ];

    return (
        <Forms.FormSection>
            <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }} tag="h2">
                Vencord Desktop Settings
            </Text>

            <Forms.FormTitle className={Margins.top16}>Discord Branch</Forms.FormTitle>
            <Select
                placeholder="Stable"
                options={[
                    { label: "Stable", value: "stable", default: true },
                    { label: "Canary", value: "canary" },
                    { label: "PTB", value: "ptb" }
                ]}
                closeOnSelect={true}
                select={v => (Settings.discordBranch = v)}
                isSelected={v => v === Settings.discordBranch}
                serialize={s => s}
            />

            <Forms.FormDivider className={Margins.top16 + " " + Margins.bottom16} />

            {switches.map(([key, text, note, def, predicate]) => (
                <Switch
                    value={(Settings[key as any] ?? def ?? false) && predicate?.() !== false}
                    disabled={predicate && !predicate()}
                    onChange={v => (Settings[key as any] = v)}
                    note={note}
                    key={key}
                >
                    {text}
                </Switch>
            ))}

            <Forms.FormTitle>Vencord Location</Forms.FormTitle>
            <Forms.FormText>
                Vencord files are loaded from{" "}
                {Settings.vencordDir ? (
                    <a
                        href="about:blank"
                        onClick={e => {
                            e.preventDefault();
                            VencordDesktopNative.fileManager.showItemInFolder(Settings.vencordDir!);
                        }}
                    >
                        {Settings.vencordDir}
                    </a>
                ) : (
                    "the default location"
                )}
            </Forms.FormText>
            <div className="vcd-location-btns">
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={async () => {
                        const choice = await VencordDesktopNative.fileManager.selectVencordDir();
                        switch (choice) {
                            case "cancelled":
                            case "invalid":
                                // TODO
                                return;
                        }
                        Settings.vencordDir = choice;
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={() => (Settings.vencordDir = void 0)}
                >
                    Reset
                </Button>
            </div>
        </Forms.FormSection>
    );
}
