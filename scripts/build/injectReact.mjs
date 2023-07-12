/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

export const VencordFragment = /* #__PURE__*/ Symbol.for("react.fragment");
export let VencordCreateElement = (...args) =>
    (VencordCreateElement = Vencord.Webpack.Common.React.createElement)(...args);
