const { update, version: currentVersion } = await VesktopUpdaterNative.getData();

document.getElementById("current-version").textContent = currentVersion;
document.getElementById("new-version").textContent = update.version;
document.getElementById("release-notes").innerHTML = update.releaseNotes
    .map(
        ({ version, note: html }) => `
            <section>
                <h3>Version ${version}</h3>
                <div>${html.replace(/<\/?h([1-3])/g, (m, level) => m.replace(level, Number(level) + 3))}</div>
            </section>
        `
    )
    .join("\n");

document.querySelectorAll("a").forEach(a => {
    a.target = "_blank";
});

// remove useless headings
document.querySelectorAll("h3, h4, h5, h6").forEach(h => {
    if (h.textContent.trim().toLowerCase() === "what's changed") {
        h.remove();
    }
});

/** @type {HTMLDialogElement} */
const updateDialog = document.getElementById("update-dialog");
/** @type {HTMLDialogElement} */
const installingDialog = document.getElementById("installing-dialog");
/** @type {HTMLProgressElement} */
const downloadProgress = document.getElementById("download-progress");
/** @type {HTMLElement} */
const errorText = document.getElementById("error");

document.getElementById("update-button").addEventListener("click", () => {
    downloadProgress.value = 0;
    errorText.textContent = "";

    if (navigator.platform.startsWith("Linux")) {
        document.getElementById("linux-note").classList.remove("hidden");
    }

    updateDialog.showModal();

    VesktopUpdaterNative.installUpdate().then(() => {
        downloadProgress.value = 100;
        updateDialog.closedBy = "any";

        installingDialog.showModal();
        updateDialog.classList.add("hidden");
    });
});

document.getElementById("later-button").addEventListener("click", () => VesktopUpdaterNative.snoozeUpdate());
document.getElementById("ignore-button").addEventListener("click", () => {
    const confirmed = confirm(
        "Are you sure you want to ignore this update? You will not be notified about this update again. Updates are important for security and stability."
    );
    if (confirmed) VesktopUpdaterNative.ignoreUpdate();
});

VesktopUpdaterNative.onProgress(percent => (downloadProgress.value = percent));
VesktopUpdaterNative.onError(message => {
    updateDialog.closedBy = "any";
    errorText.textContent = `An error occurred while downloading the update: ${message}`;
    installingDialog.close();
    updateDialog.classList.remove("hidden");
});
