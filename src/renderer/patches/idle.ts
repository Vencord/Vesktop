/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: "IdleStore",
            replacement: [
                /* eslint-disable no-useless-escape */
                {
                    match: /(?<=return )\i\|\|\i/,
                    replace:
                        "VesktopNative.powerMonitor.isSuspended() || VesktopNative.powerMonitor.isLocked() || VesktopNative.powerMonitor.isWaylandIdle()"
                },
                // replace function names so it's easier to call ourselves, not sure if there's a better to do this?
                // from what I can tell these functions are only called within module so replacing them should be fine
                {
                    match: /(?<=function )\i(?=\(\)\{var \i;)|(?<=setTimeout\()\i/g,
                    replace: "checkNativeIdlePatched"
                },
                {
                    match: /(?<=function )\i(?=\(\i\)\{\i\.\i\.getConfig)/,
                    replace: "handlePowerEventPatched"
                },
                {
                    match: /\(null===\i\.\i\|\|void 0===\i\.\i\|\|null==\(\i=\i\.\i\.remotePowerMonitor\)\?void 0:\i\.getSystemIdleTimeMs\)!=null/,
                    replace: "true"
                },
                {
                    match: /\i\.\i\.remotePowerMonitor(?=\.getSystemIdleTimeMs\(\))/,
                    replace: "VesktopNative.powerMonitor"
                },
                {
                    match: /setInterval\(\i,30\*\i\.\i\.Millis\.SECOND\)/,
                    replace: "($self.vesktopNativeIdleInit(handlePowerEventPatched), checkNativeIdlePatched())"
                }
            ]
        }
    ],
    vesktopNativeIdleInit(handlePowerEvent: (idle: boolean) => boolean) {
        VesktopNative.powerMonitor.onIdlePowerEvent(() => handlePowerEvent(true));
        VesktopNative.powerMonitor.onNoIdlePowerEvent(() => handlePowerEvent(false));
    }
});
