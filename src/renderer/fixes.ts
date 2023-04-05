import "./hideGarbage.css";
import { isFirstRun, localStorage } from "./utils";

// Make clicking Notifications focus the window
const originalSetOnClick = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")!.set!;
Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
        originalSetOnClick.call(this, function (this: unknown) {
            onClick.apply(this, arguments);
            VencordDesktop.win.focus();
        });
    },
    configurable: true
});

// Enable Desktop Notifications by default
if (isFirstRun) {
    // Hide "Download Discord Desktop now!!!!" banner
    localStorage.setItem("hideNag", "true");

    Vencord.Webpack.waitFor("setDesktopType", m => {
        m.setDesktopType("all");
    });
}
