/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";

const logger = new Logger("FixCameraConstraints");

// These seem higher than what Discord supports, at least on my end, so I
// think this will just make Electron pick the highest res/fps.
const PREFERRED_WIDTH = 1920;
const PREFERRED_HEIGHT = 1080;
const PREFERRED_FRAMERATE = 60;

function fixStreamConstraints(constraints: MediaStreamConstraints | undefined) {
    if (!constraints?.video) return;

    if (typeof constraints.video !== "object") {
        constraints.video = {};
    }

    constraints.video = {
        ...constraints.video,
        // Only set ideal values. That way, if it turns out the camera doesn't
        // support them, Electron can still pick something else.
        width: { ideal: PREFERRED_WIDTH },
        height: { ideal: PREFERRED_HEIGHT },
        frameRate: { ideal: PREFERRED_FRAMERATE }
    };
}

const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
navigator.mediaDevices.getUserMedia = function (constraints) {
    try {
        fixStreamConstraints(constraints);
        logger.debug("Fixed getUserMedia constraints for video", constraints);
    } catch (e) {
        logger.error("Failed to fix getUserMedia constraints for video", e);
    }

    return originalGetUserMedia.call(this, constraints);
};
