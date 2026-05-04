export function getAccentColor(): number | null;
export function getWindowProcessId(windowHandle: string | number): number | null;
export function requestBackground(autoStart: boolean, commandLine: string[]): boolean;
export function supportsProcessLoopback(): boolean;
export function updateUnityLauncherCount(count: number): boolean;
