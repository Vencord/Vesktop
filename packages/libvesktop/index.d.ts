import { EventEmitter } from "node:events";

export function requestBackground(autoStart: boolean, commandLine: string[]): boolean;
export function updateUnityLauncherCount(count: number): boolean;

export interface XDPGlobalShortcutEvents {
    ready: [];
    error: [error: string];
    fatal: [error: string];
    shortcutEvent: [id: string, pressed: boolean, timestamp: number];
    shortcutsBound: [{ id: string; enabled: boolean; action: string; key: string }[]];
    portalVersion: [version: number];
}

export interface XDPShortcut {
    id: string;
    description: string;
    preferred_trigger?: string;
}

export class XDPGlobalShortcuts extends EventEmitter {
    constructor(emitter: EventEmitter);

    bindShortcuts(shortcuts: XDPShortcut[]): void;
    configureShortcuts(): void;
    destroy(): void;

    on<K extends keyof XDPGlobalShortcutEvents>(
        event: K,
        listener: (...args: XDPGlobalShortcutEvents[K]) => void
    ): this;

    once<K extends keyof XDPGlobalShortcutEvents>(
        event: K,
        listener: (...args: XDPGlobalShortcutEvents[K]) => void
    ): this;

    emit<K extends keyof XDPGlobalShortcutEvents>(event: K, ...args: XDPGlobalShortcutEvents[K]): boolean;
}
