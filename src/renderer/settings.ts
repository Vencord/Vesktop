/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { SettingsStore } from "shared/utils/SettingsStore";

import { Common } from "./vencord";

export const Settings = new SettingsStore(VencordDesktopNative.settings.get());
Settings.addGlobalChangeListener((o, p) => VencordDesktopNative.settings.set(o, p));

export function useSettings() {
    const [, update] = Common.React.useReducer(x => x + 1, 0);

    Common.React.useEffect(() => {
        Settings.addGlobalChangeListener(update);

        return () => Settings.removeGlobalChangeListener(update);
    }, []);

    return Settings.store;
}

export function getValueAndOnChange(key: keyof typeof Settings.store) {
    return {
        value: Settings.store[key] as any,
        onChange: (value: any) => (Settings.store[key] = value)
    };
}
