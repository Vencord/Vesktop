/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Recursively merges defaults into an object and returns the same object
 * @param obj Object
 * @param defaults Defaults
 * @returns obj
 */
export function mergeDefaults<T>(obj: T, defaults: T): T {
    for (const key in defaults) {
        const v = defaults[key];
        if (typeof v === "object" && !Array.isArray(v) && v !== null) {
            obj[key] ??= {} as any;
            mergeDefaults(obj[key], v);
        } else {
            obj[key] ??= v;
        }
    }
    return obj;
}
