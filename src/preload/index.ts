/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron";
import { readFileSync, watch } from "fs";

import { IpcEvents } from "../shared/IpcEvents";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);

// handle legacy Chrome constraints
function setLegacyChromeConstraint(constraint, name, value) {
    if (constraint.mandatory && name in constraint.mandatory) {
        constraint.mandatory[name] = value;
        return;
    }
    if (constraint.optional) {
        const element = constraint.optional.find(opt => name in opt);
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

// handle modern constraints
function setConstraint(constraint, name, value) {
    if (constraint.advanced) {
        const element = constraint.advanced.find(opt => name in opt);
        if (element) {
            element[name] = value;
            return;
        }
    }
    constraint[name] = value;
}

// self explanatory
function disableAutogain(constraints) {
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

// Patch function utility
function patchFunction(object, name, createNewFunction) {
    if (name in object) {
        const original = object[name];
        object[name] = createNewFunction(original);
    }
}

// Apply patches if the setting is enabled
if (VesktopNative.settings.get().disableAutoGain) {
    patchFunction(navigator.mediaDevices, "getUserMedia", function (original) {
        return function getUserMedia(constraints) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    patchFunction(navigator, "getUserMedia", function (original) {
        return function getUserMedia(constraints, success, error) {
            disableAutogain(constraints);
            return original.call(this, constraints, success, error);
        };
    });

    patchFunction(navigator, "mozGetUserMedia", function (original) {
        return function getUserMedia(constraints, success, error) {
            disableAutogain(constraints);
            return original.call(this, constraints, success, error);
        };
    });

    patchFunction(navigator, "webkitGetUserMedia", function (original) {
        return function getUserMedia(constraints, success, error) {
            disableAutogain(constraints);
            return original.call(this, constraints, success, error);
        };
    });

    patchFunction(MediaStreamTrack.prototype, "applyConstraints", function (original) {
        return function applyConstraints(constraints) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    console.log("Auto Gain Control disabled via settings.");
}

require(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_FILE));

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_RENDERER_SCRIPT));

// #region css
const rendererCss = ipcRenderer.sendSync(IpcEvents.GET_RENDERER_CSS_FILE);

const style = document.createElement("style");
style.id = "vcd-css-core";
style.textContent = readFileSync(rendererCss, "utf-8");

if (document.readyState === "complete") {
    document.documentElement.appendChild(style);
} else {
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(style), {
        once: true
    });
}

if (IS_DEV) {
    // persistent means keep process running if watcher is the only thing still running
    // which we obviously don't want
    watch(rendererCss, { persistent: false }, () => {
        document.getElementById("vcd-css-core")!.textContent = readFileSync(rendererCss, "utf-8");
    });
}
// #endregion