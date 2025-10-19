/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useAwaiter } from "@vencord/types/utils";
import { Button, Text } from "@vencord/types/webpack/common";

import { cl } from "./Settings";

export function Updater() {
    const [isOutdated] = useAwaiter(VesktopNative.app.isOutdated);

    if (!isOutdated) return null;

    return (
        <div className={cl("updater-card")}>
            <Text variant="text-md/semibold">Your Vesktop is outdated!</Text>
            <Text variant="text-sm/normal">Staying up to date is important for security and stability.</Text>

            <Button
                onClick={() => VesktopNative.app.openUpdater()}
                size={Button.Sizes.SMALL}
                color={Button.Colors.TRANSPARENT}
            >
                Open Updater
            </Button>
        </div>
    );
}
