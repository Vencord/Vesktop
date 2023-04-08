export interface Settings {
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    discordBranch?: "stable" | "canary" | "ptb";
    openLinksWithElectron?: boolean;
}
