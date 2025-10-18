/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2025 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { stripIndent } from "shared/utils/text";
import { parseArgs, ParseArgsOptionDescriptor } from "util";

const options = {
    "start-minimized": {
        default: false,
        type: "boolean",
        short: "m",
        description: "Start the application minimized to the system tray"
    },
    version: {
        type: "boolean",
        short: "v",
        description: "Print the application version and exit"
    },
    help: {
        type: "boolean",
        short: "h",
        description: "Print help information and exit"
    },
    "user-agent": {
        type: "string",
        argumentName: "ua",
        description: "Set a custom User-Agent. May trigger anti-spam or break voice chat"
    },
    "user-agent-os": {
        type: "string",
        description: "Set User-Agent to a specific operating system. May trigger anti-spam or break voice chat",
        options: ["windows", "linux", "darwin"]
    }
} satisfies Record<
    string,
    ParseArgsOptionDescriptor & { description: string; options?: string[]; argumentName?: string }
>;

export const CommandLine = parseArgs({
    options,
    strict: true,
    allowPositionals: true
});

export function checkCommandLineForHelpOrVersion() {
    const { help, version } = CommandLine.values;

    if (version) {
        console.error(`Vesktop v${app.getVersion()}`);
        app.exit(0);
    }

    if (help) {
        const base = stripIndent`
            Vesktop v${app.getVersion()}

            Usage: ${process.execPath} [options] [url]

            Options:
        `;

        const optionLines = Object.entries(options)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, opt]) => {
                const flags = [
                    "short" in opt && `-${opt.short}`,
                    `--${name}`,
                    opt.type !== "boolean" &&
                        ("options" in opt ? `<${opt.options.join(" | ")}>` : `<${opt.argumentName ?? opt.type}>`)
                ]
                    .filter(Boolean)
                    .join(" ");

                return [flags, opt.description];
            });

        const padding = optionLines.reduce((max, [flags]) => Math.max(max, flags.length), 0) + 4;

        const optionsHelp = optionLines
            .map(([flags, description]) => `  ${flags.padEnd(padding, " ")}${description}`)
            .join("\n");

        console.error(base + "\n" + optionsHelp);
        app.exit(0);
    }

    for (const [name, def] of Object.entries(options)) {
        const value = CommandLine.values[name];
        if (!value) continue;

        if ("options" in def && !def.options?.includes(value)) {
            console.error(`Invalid value for --${name}: ${value}\nExpected one of: ${def.options.join(", ")}`);
            app.exit(1);
        }
    }
}
