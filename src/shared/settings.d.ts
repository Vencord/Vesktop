import type { Rectangle } from "electron";

export interface Settings {
    maximized?: boolean;
    minimized?: boolean;
    windowBounds?: Rectangle;
    discordBranch?: "stable" | "canary" | "ptb";
    openLinksWithElectron?: boolean;
    vencordDir?: string;
    disableMinSize?: boolean;
}
