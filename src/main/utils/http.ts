/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { createWriteStream } from "fs";
import type { IncomingMessage } from "http";
import { get, RequestOptions } from "https";
import { finished } from "stream/promises";

export async function downloadFile(url: string, file: string, options: RequestOptions = {}) {
    const res = await simpleReq(url, options);
    await finished(
        res.pipe(
            createWriteStream(file, {
                autoClose: true
            })
        )
    );
}

export function simpleReq(url: string, options: RequestOptions = {}) {
    return new Promise<IncomingMessage>((resolve, reject) => {
        get(url, options, res => {
            const { statusCode, statusMessage, headers } = res;
            if (statusCode! >= 400) return void reject(`${statusCode}: ${statusMessage} - ${url}`);
            if (statusCode! >= 300) return simpleReq(headers.location!, options).then(resolve).catch(reject);

            resolve(res);
        });
    });
}

export async function simpleGet(url: string, options: RequestOptions = {}) {
    const res = await simpleReq(url, options);

    return new Promise<Buffer>((resolve, reject) => {
        const chunks = [] as Buffer[];

        res.once("error", reject);
        res.on("data", chunk => chunks.push(chunk));
        res.once("end", () => resolve(Buffer.concat(chunks)));
    });
}
