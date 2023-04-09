/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

type Func = (...args: any[]) => any;

export function monkeyPatch<O extends object>(
    object: O,
    key: keyof O,
    replacement: (original: Func, ...args: any[]) => any
): void {
    const original = object[key] as Func;

    const replacer = (object[key] = function (this: unknown, ...args: any[]) {
        return replacement.call(this, original, ...args);
    } as any);

    Object.defineProperties(replacer, Object.getOwnPropertyDescriptors(original));
    replacer.toString = () => original.toString();
    replacer.$$original = original;
}
