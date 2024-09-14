/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2024 Vendicated and Vencord contributors
 */

import { Margins } from "@vencord/types/utils";
import { Select, Forms } from "@vencord/types/webpack/common";
import { isMac, isWindows } from "renderer/utils";

import { SettingsComponent } from "./Settings";

export const TitleBarPicker: SettingsComponent = ({ settings }) => {
    return (
        <>
            <Forms.FormText className={Margins.bottom8}>
                Customize apps title bar. Pick Discord if you want to use Discord's custom title bar. Requires a full restart
            </Forms.FormText>
            <Select
                placeholder="Hidden"
                options={[
                    ...(isMac ? [{ label: "Hidden", value: "hidden", default: isMac }] : []),
                    { label: "Native", value: "shown" },
                    { label: "Discord", value: "custom", default: isWindows }
                ]}
                closeOnSelect={true}
                select={v => (settings.titleBar = v)}
                isSelected={v => v === settings.titleBar}
                serialize={s => s}
            />
            <Forms.FormDivider className={Margins.top16 + " " + Margins.bottom16} />
        </>
    );
};