/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setObservedGamesCallback } from "../rpc";
import { addPatch } from "./shared";

addPatch({
    patches: [
        // RunningGameStore has everything needed for RPC even on Web, it just has no native server for it. Re-enable support
        {
            find: 'displayName="RunningGameStore"',
            // The lock check throws on web and crashes the UI, so only enable detection if it can be patched too
            group: true,
            replacement: [
                {
                    match: /if\((\i)\)(?=.+?canCollectExecutableFingerprintsForRunningGames\(\)\{return \1\})/,
                    replace: "if(true)"
                },
                // Function used by the Overlay and called for running games. The overlay causes a crash due to missing native utils
                // Return false to make the lock fail, which skips Overlay
                {
                    match: /acquireLock=\i=>\{/,
                    replace: "$&return false;"
                }
            ]
        },

        {
            find: ",setSystemTrayApplications",
            replacement: [
                {
                    match: /setObservedGamesCallback\(\i,\i,(\i),\i\)\{/,
                    replace: "$&return VesktopPatchGlobals.setObservedGamesCallback($1);"
                },
                {
                    match: /setGameDetection(Error)?Callback\(\i\)\{/g,
                    replace: "$&return;"
                },
                // Called by overlay for running games. Will print an ugly error to the console due to missing native utils
                {
                    match: /((?:GetWindowFullscreenTypeByPid|GetWindowFullscreenTypeExtraByPid|GameDisplayModeIsGameSupported)\((?:\i,)*\i\)\{let\{\i:\i\}=)this\.getDiscordUtils\(\)/g,
                    replace: "$1{}"
                }
            ]
        },

        // The card above the user panel. Commented out because:
        // - Patch doesn't seem very stable
        // - This has high crash potential. It's a UI element that always renders and Discord may introduce DiscordNative usage, as it is
        //   supposed to be Desktop-only

        // {
        //     find: 'location:"ActivityPanelGameCard",applicationId',
        //     replacement: {
        //         match: /(=null!=\i&&)\(\i\|\|\i\|\|\i\)(?=&&\(!\i\|\|\i\?\.pid!=null\))/,
        //         replace: "$1true"
        //     }
        // },

        // Registered Games settings page
        {
            find: ".REGISTERED_GAMES_SIDEBAR_ITEM,{",
            replacement: [
                {
                    match: /(\.REGISTERED_GAMES_SIDEBAR_ITEM,\{.{0,100}?usePredicate:)\i\.\i/,
                    replace: "$1()=>true"
                },
                {
                    match: /(\.getGamesSeen\(!1\)\.some\(.{0,30}?\)\)&&)\(0,\i\.\i\)\(\)/g,
                    replace: "$1true"
                }
            ]
        }
    ],

    setObservedGamesCallback
});
