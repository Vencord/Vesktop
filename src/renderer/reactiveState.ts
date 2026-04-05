/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useForceUpdater } from "@vencord/types/utils";
import { useEffect } from "@vencord/types/webpack/common";

interface ReactiveValue<T> {
    value: T;
    use(): T;
}

export function reactiveValue<T>(initialValue: T): ReactiveValue<T>;
export function reactiveValue<T>(initialValue?: T): ReactiveValue<T | undefined>;
export function reactiveValue<T>(initialValue?: T) {
    const changeListeners = new Set<() => void>();
    let value = initialValue;

    return {
        get value() {
            return value;
        },
        set value(newValue) {
            value = newValue;
            changeListeners.forEach(cb => cb());
        },
        use() {
            const update = useForceUpdater();

            useEffect(() => {
                changeListeners.add(update);
                return () => void changeListeners.delete(update);
            }, []);

            return value;
        }
    };
}
