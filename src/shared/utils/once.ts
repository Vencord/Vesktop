/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

/**
 * Wraps the given function so that it can only be called once
 * @param fn Function to wrap
 * @returns New function that can only be called once
 */
export function once<T extends Function>(fn: T): T {
    let called = false;
    return function (this: any, ...args: any[]) {
        if (called) return;
        called = true;
        return fn.apply(this, args);
    } as any;
}
