declare global {
    export var VencordDesktop: typeof import("./preload/VencordDesktop").VencordDesktop;
    // TODO
    export var Vencord: any;
    export var vcdLS: typeof localStorage;
}

export { };
