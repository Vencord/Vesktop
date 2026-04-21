/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Wraps the given function so that it can only be called once
 * @param fn Function to wrap
 * @returns New function that can only be called once
 */
export function once<T extends (...args: any[]) => any>(fn: T): (...args: Parameters<T>) => ReturnType<T> | undefined {
    let called = false;
    let result: ReturnType<T> | undefined;
    return (...args: Parameters<T>) => {
        if (called) return result;
        called = true;
        result = fn(...args);
        return result;
    };
}
