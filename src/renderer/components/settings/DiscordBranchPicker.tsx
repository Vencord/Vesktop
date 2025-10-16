/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ErrorBoundary } from "@vencord/types/components";
import { Select } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";

export const DiscordBranchPicker: SettingsComponent = ({ settings }) => {
    return (
        <ErrorBoundary noop>
            <Select
                placeholder="Stable"
                options={[
                    { label: "Stable", value: "stable", default: true },
                    { label: "Canary", value: "canary" },
                    { label: "PTB", value: "ptb" }
                ]}
                closeOnSelect={true}
                select={v => (settings.discordBranch = v)}
                isSelected={v => v === settings.discordBranch}
                serialize={s => s}
            />
        </ErrorBoundary>
    );
};
