/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@vencord/types/components";
import { useAwaiter } from "@vencord/types/utils";
import { Button } from "@vencord/types/webpack/common";

import { cl } from "./Settings";

export function Updater() {
    const [isOutdated] = useAwaiter(VesktopNative.app.isOutdated);

    if (!isOutdated) return null;

    return (
        <div className={cl("updater-card")}>
            <Paragraph size="md" weight="semibold">
                Your Vesktop is outdated!
            </Paragraph>
            <Paragraph size="sm" weight="normal">
                Staying up to date is important for security and stability.
            </Paragraph>

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
