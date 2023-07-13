/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

/**
 * Returns a new function that will only be called after the given delay.
 * Subsequent calls will cancel the previous timeout and start a new one from 0
 *
 * Useful for grouping multiple calls into one
 */
export function debounce<T extends Function>(func: T, delay = 300): T {
    let timeout: NodeJS.Timeout;
    return function (...args: any[]) {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func(...args);
        }, delay);
    } as any;
}
