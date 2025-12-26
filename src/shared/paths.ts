/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { join } from "path";

export const STATIC_DIR = /* @__PURE__ */ join(__dirname, "..", "..", "static");
export const BADGE_DIR = /* @__PURE__ */ join(STATIC_DIR, "badges");
