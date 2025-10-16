/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ErrorBoundary } from "@vencord/types/components";
import { Margins } from "@vencord/types/utils";
import { Forms, Select } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";

export const WindowsTransparencyControls: SettingsComponent = ({ settings }) => {
    if (!VesktopNative.app.supportsWindowsTransparency()) return null;

    return (
        <ErrorBoundary noop>
            <div>
                <Forms.FormTitle className={Margins.bottom8}>Transparency Options</Forms.FormTitle>
                <Forms.FormText className={Margins.bottom8}>
                    Requires a full restart. You will need a theme that supports transparency for this to work.
                </Forms.FormText>

                <Select
                    placeholder="None"
                    options={[
                        {
                            label: "None",
                            value: "none",
                            default: true
                        },
                        {
                            label: "Mica (incorporates system theme + desktop wallpaper to paint the background)",
                            value: "mica"
                        },
                        { label: "Tabbed (variant of Mica with stronger background tinting)", value: "tabbed" },
                        {
                            label: "Acrylic (blurs the window behind Vesktop for a translucent background)",
                            value: "acrylic"
                        }
                    ]}
                    closeOnSelect={true}
                    select={v => (settings.transparencyOption = v)}
                    isSelected={v => v === settings.transparencyOption}
                    serialize={s => s}
                />
            </div>
        </ErrorBoundary>
    );
};
