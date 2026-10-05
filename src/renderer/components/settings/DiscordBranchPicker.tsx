/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Alerts, Select } from "@vencord/types/webpack/common";

import { SimpleErrorBoundary } from "../SimpleErrorBoundary";
import { SettingsComponent } from "./Settings";

export const DiscordBranchPicker: SettingsComponent = ({ settings }) => {
    return (
        <SimpleErrorBoundary>
            <Select
                placeholder="Stable"
                options={[
                    { label: "Stable", value: "stable", default: true },
                    { label: "Canary", value: "canary" },
                    { label: "PTB", value: "ptb" }
                ]}
                closeOnSelect={true}
                select={v => {
                    if (v !== "stable" && settings.discordBranch !== v) {
                        Alerts.show({
                            title: "Warning",
                            body: "In most cases you do not need to use canary or PTB branches. These branches sometimes have breaking changes that affect the functionality of Vencord."
                        });
                    }
                    settings.discordBranch = v;
                }}
                isSelected={v => v === settings.discordBranch}
                serialize={s => s}
            />
        </SimpleErrorBoundary>
    );
};
