/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@vencord/types/utils";
import { MediaEngineStore } from "renderer/common";

const logger = new Logger("FixAutoGain");

function fixTrackConstraints(constraint: MediaTrackConstraints) {
    const target = constraint.advanced?.find(opt => Object.hasOwn(opt, "autoGainControl")) ?? constraint;

    target.autoGainControl = MediaEngineStore.getAutomaticGainControl();
}

function fixStreamConstraints(constraints: MediaStreamConstraints | undefined) {
    if (!constraints?.audio) return;

    if (typeof constraints.audio !== "object") {
        constraints.audio = {};
    }

    fixTrackConstraints(constraints.audio);
}

const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
navigator.mediaDevices.getUserMedia = function (constraints) {
    try {
        fixStreamConstraints(constraints);
        logger.debug("Fixed getUserMedia constraints", constraints);
    } catch (e) {
        logger.error("Failed to fix getUserMedia constraints", e);
    }

    return originalGetUserMedia.call(this, constraints);
};

const originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
MediaStreamTrack.prototype.applyConstraints = function (constraints) {
    if (constraints) {
        try {
            fixTrackConstraints(constraints);
            logger.debug("Fixed applyConstraints constraints", constraints);
        } catch (e) {
            logger.error("Failed to fix applyConstraints constraints", e);
        }
    }
    return originalApplyConstraints.call(this, constraints);
};
