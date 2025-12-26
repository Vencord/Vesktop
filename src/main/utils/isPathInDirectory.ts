/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { resolve, sep } from "path";

export function isPathInDirectory(filePath: string, directory: string) {
    const resolvedPath = resolve(filePath);
    const resolvedDirectory = resolve(directory);

    const normalizedDirectory = resolvedDirectory.endsWith(sep) ? resolvedDirectory : resolvedDirectory + sep;

    return resolvedPath.startsWith(normalizedDirectory) || resolvedPath === resolvedDirectory;
}
