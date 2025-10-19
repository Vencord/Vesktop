/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@vencord/types/components";
import { ComponentProps } from "react";

import { cl } from "./Settings";

export function VesktopSettingsSwitch(props: ComponentProps<typeof FormSwitch>) {
    return <FormSwitch {...props} hideBorder className={cl("switch")} />;
}
