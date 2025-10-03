/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access, constants } from "fs/promises";

export async function fileExistsAsync(path: string) {
    return await access(path, constants.F_OK)
        .then(() => true)
        .catch(() => false);
}
