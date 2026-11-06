/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { XDPGlobalShortcuts, XDPGlobalShortcutsEvent } from "libvesktop";
import { ACTION_DESCRIPTIONS, isShortcutAction, SHORTCUT_ACTIONS } from "shared/utils/keybind";

import { createXDPGlobalShortcuts } from "../dbus";
import { setStatus, status, triggerAction } from "./actions";

let session: XDPGlobalShortcuts | null = null;

function onEvent(...event: XDPGlobalShortcutsEvent) {
    switch (event[0]) {
        case "version":
            setStatus({ ...status, portalVersion: event[1] });
            break;
        case "ready":
            // The portal decides the triggers, so we register every action and let the user assign the ones they want
            session?.bindShortcuts(SHORTCUT_ACTIONS.map(id => ({ id, description: ACTION_DESCRIPTIONS[id] })));
            setStatus({ ...status, portalState: "ready" });
            break;
        case "shortcuts": {
            // Portals only return shortcuts that have a trigger assigned
            const triggers = new Map(event[1].map(s => [s.id, s.trigger]));
            const portalShortcuts = SHORTCUT_ACTIONS.map(id => ({
                id,
                description: ACTION_DESCRIPTIONS[id],
                trigger: triggers.get(id) ?? ""
            }));
            setStatus({ ...status, portalShortcuts, error: undefined });
            break;
        }
        case "shortcut":
            if (isShortcutAction(event[1])) triggerAction(event[1], event[2]);
            break;
        case "error":
            console.error("GlobalShortcuts portal error:", event[1]);
            setStatus({ ...status, error: event[1] });
            break;
        case "fatal":
            console.error("GlobalShortcuts portal is unavailable:", event[1]);
            stopPortal();
            setStatus({ ...status, portalState: "unavailable", error: event[1] });
            break;
    }
}

export function stopPortal() {
    session?.destroy();
    session = null;
}

export function setPortalEnabled(enabled: boolean) {
    if (!enabled) {
        stopPortal();
        setStatus({ portalState: "disabled" });
        return;
    }

    if (session) return;

    setStatus({ portalState: "connecting" });
    try {
        session = createXDPGlobalShortcuts(onEvent);
        if (!session) setStatus({ portalState: "unavailable", error: "Failed to load libvesktop" });
    } catch (err) {
        console.error("Failed to create GlobalShortcuts portal session:", err);
        setStatus({ portalState: "unavailable", error: String(err) });
    }
}

export function configurePortalShortcuts() {
    session?.configureShortcuts();
}
