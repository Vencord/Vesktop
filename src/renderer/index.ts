/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./fixes";
import "./appBadge";
import "./patches";
import "./themedSplash";

console.log("read if cute :3");

export * as Components from "./components";
import { findByPropsLazy, onceReady } from "@vencord/types/webpack";
import { Alerts, FluxDispatcher } from "@vencord/types/webpack/common";

import SettingsUi from "./components/settings/Settings";
import { Settings } from "./settings";
export { Settings };

const InviteActions = findByPropsLazy("resolveInvite");

export async function openInviteModal(code: string) {
    const { invite } = await InviteActions.resolveInvite(code, "Desktop Modal");
    if (!invite) return false;

    VesktopNative.win.focus();

    FluxDispatcher.dispatch({
        type: "INVITE_MODAL_OPEN",
        invite,
        code,
        context: "APP"
    });

    return true;
}

const customSettingsSections = (
    Vencord.Plugins.plugins.Settings as any as { customSections: ((ID: Record<string, unknown>) => any)[] }
).customSections;

customSettingsSections.push(() => ({
    section: "Vesktop",
    label: "Vesktop Settings",
    element: SettingsUi,
    className: "vc-vesktop-settings"
}));

const arRPC = Vencord.Plugins.plugins["WebRichPresence (arRPC)"] as any as {
    handleEvent(e: MessageEvent): void;
};

VesktopNative.arrpc.onActivity(async data => {
    if (!Settings.store.arRPC) return;

    await onceReady;

    arRPC.handleEvent(new MessageEvent("message", { data }));
});

// Force disable automatic gain control
(function () {
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
        // `mandatory` options throw errors for unknown keys, so avoid that by
        // setting it under optional.
        if (!constraint.optional) {
            constraint.optional = [];
        }
        constraint.optional.push({ [name]: value });
    }

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

    function disableAutogain(constraints) {
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

    function patchFunction(object, name, createNewFunction) {
        if (name in object) {
            var original = object[name];
            object[name] = createNewFunction(original);
        }
    }

    patchFunction(navigator.mediaDevices, "getUserMedia", function (original) {
        return function getUserMedia(constraints) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    function patchDeprecatedGetUserMedia(original) {
        return function getUserMedia(constraints, success, error) {
            disableAutogain(constraints);
            return original.call(this, constraints, success, error);
        };
    }

    patchFunction(navigator, "getUserMedia", patchDeprecatedGetUserMedia);
    patchFunction(navigator, "mozGetUserMedia", patchDeprecatedGetUserMedia);
    patchFunction(navigator, "webkitGetUserMedia", patchDeprecatedGetUserMedia);

    patchFunction(MediaStreamTrack.prototype, "applyConstraints", function (original) {
        return function applyConstraints(constraints) {
            disableAutogain(constraints);
            return original.call(this, constraints);
        };
    });

    console.log("Disable Autogain by Joey Watts!", navigator.mediaDevices.getUserMedia);
})();

// TODO: remove soon
const vencordDir = "vencordDir" as keyof typeof Settings.store;
if (Settings.store[vencordDir]) {
    onceReady.then(() =>
        setTimeout(
            () =>
                Alerts.show({
                    title: "Custom Vencord Location",
                    body: "Due to security hardening changes in Vesktop, your custom Vencord location had to be reset. Please configure it again in the settings.",
                    onConfirm: () => delete Settings.store[vencordDir]
                }),
            5000
        )
    );
}
