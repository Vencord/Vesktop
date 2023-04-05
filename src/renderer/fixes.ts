import "./hideGarbage.css";

// Make clicking Notifications focus the window
const originalSetOnClick = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")!.set!;
Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
        originalSetOnClick.call(this, function () {
            onClick.apply(this, arguments);
            VencordDesktop.win.focus();
        });
    },
    configurable: true
});
