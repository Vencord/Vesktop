/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

export function makeChangeListenerProxy<T extends object>(object: T, onChange: (object: T) => void, _root = object): T {
    return new Proxy(object, {
        get(target, key) {
            const v = target[key];
            if (typeof v === "object" && !Array.isArray(v) && v !== null)
                return makeChangeListenerProxy(v, onChange, _root);

            return v;
        },

        set(target, key, value) {
            if (target[key] === value) return true;

            Reflect.set(target, key, value);
            onChange(_root);

            return true;
        }
    });
}
