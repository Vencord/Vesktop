declare global {
    export var VencordDesktopNative: typeof import("preload/VencordDesktopNative").VencordDesktopNative;
    export var VencordDesktop: typeof import("renderer/index");
    // TODO
    export var Vencord: any;
    export var vcdLS: typeof localStorage;
}

export { };
