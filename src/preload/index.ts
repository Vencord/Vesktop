/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron/renderer";

import { IpcEvents } from "../shared/IpcEvents";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);

// TODO: remove this legacy workaround once some time has passed
const isSandboxed = typeof __dirname === "undefined";
if (isSandboxed) {
    // While sandboxed, Electron "polyfills" these APIs as local variables.
    // We have to pass them as arguments as they are not global
    Function(
        "require",
        "Buffer",
        "process",
        "clearImmediate",
        "setImmediate",
        ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT)
    )(require, Buffer, process, clearImmediate, setImmediate);
} else {
    require(ipcRenderer.sendSync(IpcEvents.DEPRECATED_GET_VENCORD_PRELOAD_SCRIPT_PATH));
}


//#region scroll speed hack
const scrollFactor = VesktopNative.settings.get().scrollSpeed ?? 0.24;

function wheel(event: WheelEvent) {
    const target = event.target as HTMLElement;

    if (event.defaultPrevented || event.ctrlKey) {
        return true;
    }

    let deltaX = event.deltaX;
    let deltaY = event.deltaY;

    if (event.shiftKey && !(event.ctrlKey || event.altKey || event.metaKey)) {
        deltaX = deltaX || deltaY;
        deltaY = 0;
    }

    const xOnly: boolean = (deltaX && !deltaY) as boolean;
    let element: Window|Element|null|undefined = overflowingAncestor(target, xOnly);

    if (element === getScrollRoot() || element === document.body) {
        element = window;
    }

    const isFrame = window.top !== window.self;

    if ( ! element) {
        if (isFrame) {
            parent.postMessage({
                deltaX: deltaX,
                deltaY: deltaY,
                CSS: 'ChangeScrollSpeed'
            }, '*');

            if (event.preventDefault) {
                event.preventDefault();
            }
        }

        return true;
    }

    element!.scrollBy(deltaX * scrollFactor, deltaY * scrollFactor);

    if (event.preventDefault) {
        event.preventDefault();
    }
}

function overflowingAncestor(element: HTMLElement|null, horizontal: boolean) {
    const body = document.body;
    const root = window.document.documentElement
    const rootScrollHeight = root.scrollHeight;
    const rootScrollWidth = root.scrollWidth;
    const isFrame = window.top !== window.self;

    do {
        if (horizontal && rootScrollWidth === element!.scrollWidth ||
            !horizontal && rootScrollHeight === element!.scrollHeight) {
            const topOverflowsNotHidden = overflowNotHidden(root, horizontal) && overflowNotHidden(body, horizontal);
            const isOverflowCSS = topOverflowsNotHidden || overflowAutoOrScroll(root, horizontal);

            if (isFrame && isContentOverflowing(root, horizontal) || !isFrame && isOverflowCSS) {

                return getScrollRoot()
            }
        } else if (isContentOverflowing(element!, horizontal) && overflowAutoOrScroll(element!, horizontal)) {
            return element;
        }
    } while ((element = element!.parentElement));
}

function isContentOverflowing(element: HTMLElement, horizontal: boolean) {
    const client = horizontal ? element.clientWidth : element.clientHeight;
    const scroll = horizontal ? element.scrollWidth : element.scrollHeight;

    return (client + 10 < scroll);
}

function computedOverflow(element: HTMLElement, horizontal: boolean) {
    return getComputedStyle(element, '')
        .getPropertyValue(horizontal ? 'overflow-x' : 'overflow-y');
}

function overflowNotHidden(element: HTMLElement, horizontal: boolean) {
    return computedOverflow(element, horizontal) !== 'hidden';
}

function overflowAutoOrScroll(element: HTMLElement, horizontal: boolean) {
    return /^(scroll|auto)$/.test(computedOverflow(element, horizontal));
}

function getScrollRoot() {
    return (document.scrollingElement || document.body);
}

function message(message: MessageEvent) {
    if (message.data.CSS !== 'ChangeScrollSpeed') {
        return;
    }

    let event = message.data;
    event.target = getFrameByEvent(message.source);
    wheel(event)
}

function getFrameByEvent(source: MessageEventSource | null) {
    const iframes = document.getElementsByTagName('iframe');

    return Array.prototype.filter.call(iframes, function (iframe) {
        return iframe.contentWindow === source;
    })[0];
}



const el = (window.document || window);
el.addEventListener("wheel", wheel, {passive: false})

window.addEventListener('message', message);
//#endregion

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT));
