/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

// Based on https://github.com/gergof/electron-builder-sandbox-fix/blob/master/lib/index.js

const fs = require("fs/promises");
const path = require("path");

const afterPackHook = async params => {
    if (process.platform !== "linux") {
        // this fix is only required on linux
        return;
    }

    const executable = path.join(params.appOutDir, params.packager.executableName);

    const loaderScript = `#!/usr/bin/env bash
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
IS_STEAMOS=0

if [[ "$SteamOS" == "1" && "$SteamGamepadUI" == "1" ]]; then
    echo "Running Vesktop on SteamOS, disabling sandbox"
	IS_STEAMOS=1
fi

exec "$SCRIPT_DIR/${params.packager.executableName}.bin" "$([ "$IS_STEAMOS" == 1 ] && echo '--no-sandbox')" "$@"
`;

    try {
        await fs.rename(executable, executable + ".bin");
        await fs.writeFile(executable, loaderScript);
        await fs.chmod(executable, 0o755);
    } catch (e) {
        console.error("failed to create loder for sandbox fix: " + e.message);
        throw new Error("Failed to create loader for sandbox fix");
    }
};

module.exports = afterPackHook;
