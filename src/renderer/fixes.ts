import "./hideGarbage.css";
import { isFirstRun } from "./utilts";

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

if (isFirstRun) {
    Vencord.Webpack.waitFor("setDesktopType", m => {
        m.setDesktopType("all");
    });
}
