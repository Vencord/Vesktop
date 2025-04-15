/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { setTimeout } from "timers/promises";

interface FetchieOptions {
    retryOnNetworkError?: boolean;
}

export async function downloadFile(url: string, file: string, options: RequestInit = {}, fetchieOpts?: FetchieOptions) {
    const res = await fetchie(url, options, fetchieOpts);
    await pipeline(
        // @ts-expect-error odd type error
        Readable.fromWeb(res.body!),
        createWriteStream(file, {
            autoClose: true
        })
    );
}

const ONE_MINUTE_MS = 1000 * 60;

export async function fetchie(url: string, options?: RequestInit, { retryOnNetworkError }: FetchieOptions = {}) {
    let res: Response | undefined;

    try {
        res = await fetch(url, options);
    } catch (err) {
        if (retryOnNetworkError) {
            console.error("Failed to fetch", url + ".", "Gonna retry with backoff.");

            for (let tries = 0, delayMs = 500; tries < 20; tries++, delayMs = Math.min(2 * delayMs, ONE_MINUTE_MS)) {
                await setTimeout(delayMs);
                try {
                    res = await fetch(url, options);
                    break;
                } catch {}
            }
        }

        if (!res) throw new Error(`Failed to fetch ${url}\n${err}`);
    }

    if (res.ok) return res;

    let msg = `Got non-OK response for ${url}: ${res.status} ${res.statusText}`;

    const reason = await res.text().catch(() => "");
    if (reason) msg += `\n${reason}`;

    throw new Error(msg);
}
