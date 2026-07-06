const { IdleNotifier } = require(".");

const idle_notifier = new IdleNotifier({
    timeoutMs: 1000,
    onIdled: () => console.log("event: idled"),
    onResumed: () => console.log("event: resumed")
});

console.log("Running idle loop for 30 seconds...")

let i = 0;
function tick() {
    if (i >= 30) process.exit();
    console.log("idle: ", idle_notifier.isIdle());
    setTimeout(tick, 1000);
    i++;
}

tick();
