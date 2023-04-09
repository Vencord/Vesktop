/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import type { Settings as TSettings } from "shared/settings";
import { makeChangeListenerProxy } from "shared/utils/makeChangeListenerProxy";

import { Common } from "./vencord";

const signals = new Set<() => void>();

export const PlainSettings = VencordDesktopNative.settings.get() as TSettings;
export const Settings = makeChangeListenerProxy(PlainSettings, s => {
    VencordDesktopNative.settings.set(s);
    signals.forEach(fn => fn());
});

export function useSettings() {
    const [, update] = Common.React.useReducer(x => x + 1, 0);
    Common.React.useEffect(() => {
        signals.add(update);
        return () => signals.delete(update);
    }, []);

    return Settings;
}

export function getValueAndOnChange(key: keyof TSettings) {
    return {
        value: Settings[key] as any,
        onChange: (value: any) => (Settings[key] = value)
    };
}
