const BASE_URL = "https://github.com/Vendicated/Vencord/releases/download/devbuild/";

let VencordScripts: Record<"js" | "css", string>;

async function get(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);

    return res.text();
}

export async function fetchVencord() {
    if (!VencordScripts) {
        const [js, css] = await Promise.all([
            get(BASE_URL + "/browser.js"),
            get(BASE_URL + "/browser.css")
        ]);
        VencordScripts = { js, css };
    }

    return VencordScripts;
}
