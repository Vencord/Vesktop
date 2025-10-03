/*
 * SPDX-License-Identifier: GPL-3.0
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import { Margins } from "@vencord/types/utils";
import { Forms, Slider, useEffect, useState } from "@vencord/types/webpack/common";

import { SettingsComponent } from "./Settings";

export const WindowZoom: SettingsComponent = ({ settings }) => {
    const [zoomFactor, setZoomFactor] = useState(settings.zoomFactor ?? 1);

    useEffect(() => {
        const handleZoomChange = event => {
            console.log("zoom changed", event.detail);
            setZoomFactor(event.detail);
        };

        window.addEventListener("zoomChanged", handleZoomChange);

        return () => {
            window.removeEventListener("zoomChanged", handleZoomChange);
        };
    }, []);

    return (
        <>
            <Forms.FormTitle className={Margins.top16 + " " + Margins.bottom8}>Zoom Level</Forms.FormTitle>
            <Slider
                className={Margins.top20}
                initialValue={zoomFactor}
                defaultValue={1}
                onValueChange={v => {
                    settings.zoomFactor = v;
                    VesktopNative.win.zoom(v);
                    setZoomFactor(v);
                }}
                minValue={0.5}
                maxValue={2}
                markers={[0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]}
                stickToMarkers={true}
                onMarkerRender={v => (v === 1 ? "100" : `${Math.round(v * 100)}`)}
            ></Slider>
        </>
    );
};
