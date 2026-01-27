/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";
import { VesktopSettingsSwitch } from "./VesktopSettingsSwitch";

export const OpenAsarToggle: SettingsComponent = ({ settings }) => {
    const [openAsarExists, setOpenAsarExists] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    useEffect(() => {
        VesktopNative.openasar.exists().then(setOpenAsarExists);
    }, []);

    return (
        <VesktopSettingsSwitch
            title="Use OpenAsar"
            description="Use OpenAsar for improved Discord startup performance. Requires restart."
            value={settings.useOpenAsar ?? false}
            disabled={isDownloading}
            onChange={async v => {
                settings.useOpenAsar = v;
                if (v && !openAsarExists) {
                    setIsDownloading(true);
                    try {
                        await VesktopNative.openasar.download();
                        setOpenAsarExists(true);
                    } catch (e) {
                        console.error("Failed to download OpenAsar:", e);
                        settings.useOpenAsar = false;
                    } finally {
                        setIsDownloading(false);
                    }
                }
            }}
        />
    );
};
