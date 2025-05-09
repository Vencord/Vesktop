/*
 * Disable Auto Gain Control
 * Based on https://github.com/joeywatts/disable-autogain-control-extension/blob/master/disableAutogain.js
 * Copyright (c) Joey Watts
 * SPDX-License-Identifier: MIT
 */

function setLegacyChromeConstraint(constraint: any, name: string, value: any) {
    if (constraint.mandatory && name in constraint.mandatory) {
        constraint.mandatory[name] = value;
        return;
    }
    if (constraint.optional) {
        const element = constraint.optional.find((opt: any) => name in opt);
        if (element) {
            element[name] = value;
            return;
        }
    }
    if (!constraint.optional) {
        constraint.optional = [];
    }
    constraint.optional.push({ [name]: value });
}

function setConstraint(constraint: any, name: string, value: any) {
    if (constraint.advanced) {
        const element = constraint.advanced.find((opt: any) => name in opt);
        if (element) {
            element[name] = value;
            return;
        }
    }
    constraint[name] = value;
}

function disableAutogain(constraints: any) {
    console.log("Automatically unsetting gain!", constraints);
    if (constraints && constraints.audio) {
        if (typeof constraints.audio !== "object") {
            constraints.audio = {};
        }
        if (constraints.audio.optional || constraints.audio.mandatory) {
            setLegacyChromeConstraint(constraints.audio, "googAutoGainControl", false);
            setLegacyChromeConstraint(constraints.audio, "googAutoGainControl2", false);
        } else {
            setConstraint(constraints.audio, "autoGainControl", false);
        }
    }
}

function patchFunction(object: any, name: string, createNewFunction: (original: any) => any) {
    if (name in object) {
        const original = object[name];
        object[name] = createNewFunction(original);
    }
}

export function applyDisableAutogainPatch() {
    patchFunction(navigator.mediaDevices, "getUserMedia", function (original) {
        return function getUserMedia(constraints: any) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    function patchDeprecatedGetUserMedia(original: any) {
        return function getUserMedia(constraints: any, success: any, error: any) {
            disableAutogain(constraints);
            return original.call(this, constraints, success, error);
        };
    }

    patchFunction(navigator, "getUserMedia", patchDeprecatedGetUserMedia);
    patchFunction(navigator, "mozGetUserMedia", patchDeprecatedGetUserMedia);
    patchFunction(navigator, "webkitGetUserMedia", patchDeprecatedGetUserMedia);

    patchFunction(MediaStreamTrack.prototype, "applyConstraints", function (original) {
        return function applyConstraints(constraints: any) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    console.log("Disable Autogain by Joey Watts!", navigator.mediaDevices.getUserMedia);
}
