export function requestBackground(autoStart: boolean, commandLine: string[]): boolean;
export function isStatusNotifierHostRegistered(): boolean;
export function registerHostApp(appId: string): boolean;

export interface XDPShortcut {
    id: string;
    description: string;
}

export interface XDPBoundShortcut extends XDPShortcut {
    trigger: string;
}

export type XDPGlobalShortcutsEvent =
    | [event: "version", version: number]
    | [event: "ready"]
    | [event: "fatal", message: string]
    | [event: "error", message: string]
    | [event: "shortcuts", shortcuts: XDPBoundShortcut[]]
    | [event: "shortcut", id: string, pressed: boolean];

export class XDPGlobalShortcuts {
    constructor(onEvent: (...args: XDPGlobalShortcutsEvent) => void);

    bindShortcuts(shortcuts: XDPShortcut[]): void;
    configureShortcuts(): void;
    destroy(): void;
}
