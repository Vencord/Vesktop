/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Switch } from "@vencord/types/webpack/common";
import { ComponentProps } from "react";

export function VesktopSettingsSwitch(props: ComponentProps<typeof Switch>) {
    return (
        <Switch {...props} hideBorder className="vcd-settings-switch">
            {props.children}
        </Switch>
    );
}
