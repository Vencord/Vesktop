import sharp, { OutputInfo } from "sharp";
import fastGlob from "fast-glob";
import type { ImageData } from "sharp-ico";
import { parse as pathParse, format as pathFormat } from "node:path";

interface BadgePosition {
    left?: number;
    top?: number;
    anchorX?: "left" | "right" | "center";
    anchorY?: "top" | "bottom" | "center";
}

interface BadgeOptions extends BadgePosition {
    width?: number;
    height?: number;
    resizeOptions?: sharp.ResizeOptions;
}

const DEFAULT_BADGE_OPTIONS: Required<BadgeOptions> = {
    width: 0.5,
    height: 0.5,
    left: 0.8,
    top: 0.8,
    anchorX: "center",
    anchorY: "center",
    resizeOptions: {
        kernel: sharp.kernel.cubic
    }
};

export async function composeTrayIcons({
    icon: iconPath,
    badges: badgeGlob,
    outDir,
    outExt = ".png",
    createEmpty = false,
    iconOptions = { width: 64, height: 64 },
    badgeOptions = undefined
}: {
    icon: string | Buffer | sharp.Sharp;
    badges: string;
    outDir: string;
    outExt?: string;
    createEmpty?: boolean;
    iconOptions?: ImageDim;
    badgeOptions?: BadgeOptions;
}) {
    const badges = await fastGlob.glob(badgeGlob);
    if (!badges.length) {
        throw new Error(`No badges matching glob '${badgeGlob}' found!`);
    }

    const badgeOptionsFilled = { ...DEFAULT_BADGE_OPTIONS, ...badgeOptions };
    const { data: iconData, info: iconInfo } = await resolveImageOrIco(iconPath, iconOptions);
    const iconName = typeof iconPath === "string" ? pathParse(iconPath).name : "tray_icon";

    const resizedBadgeDim = {
        height: Math.round(badgeOptionsFilled.height * iconInfo.height),
        width: Math.round(badgeOptionsFilled.width * iconInfo.width)
    };

    async function doCompose(badgePath: string | sharp.Sharp, ensureSize?: ImageDim | false) {
        const { data: badgeData, info: badgeInfo } = await resolveImageOrIco(badgePath, resizedBadgeDim);
        if (ensureSize && (badgeInfo.height !== ensureSize.height || badgeInfo.width !== ensureSize.width)) {
            throw new Error(
                `Badge loaded from ${badgePath} has size ${badgeInfo.height}x${badgeInfo.height} != ${ensureSize.height}x${ensureSize.height}`
            );
        }

        const savePath = pathFormat({
            name: iconName + (typeof badgePath === "string" ? "_" + pathParse(badgePath).name : ""),
            dir: outDir,
            ext: outExt,
            base: undefined
        });
        let out = composeTrayIcon(iconData, iconInfo, badgeData, badgeInfo, badgeOptionsFilled);
        const outputInfo = await out.toFile(savePath);
        return {
            iconInfo,
            badgeInfo,
            outputInfo
        };
    }

    if (createEmpty) {
        const firstComposition = await doCompose(badges[0]);
        return await Promise.all([
            firstComposition,
            ...badges.map(badge => doCompose(badge, firstComposition.badgeInfo)),
            doCompose(emptyImage(firstComposition.badgeInfo).png())
        ]);
    } else {
        return await Promise.all(badges.map(badge => doCompose(badge)));
    }
}

type SharpInput = string | Buffer;

interface ImageDim {
    width: number;
    height: number;
}

async function resolveImageOrIco(...args: Parameters<typeof loadFromImageOrIco>) {
    const image = await loadFromImageOrIco(...args);
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    return {
        data,
        info: validDim(info)
    };
}

async function loadFromImageOrIco(
    path: string | Buffer | sharp.Sharp,
    sizeOptions?: ImageDim & { resizeICO?: boolean }
): Promise<sharp.Sharp> {
    if (typeof path === "string" && path.endsWith(".ico")) {
        const icos = (await import("sharp-ico")).sharpsFromIco(path, undefined, true) as unknown as ImageData[];
        let icoInfo;
        if (sizeOptions == null) {
            icoInfo = icos[icos.length - 1];
        } else {
            icoInfo = icos.reduce((best, ico) =>
                Math.abs(ico.width - sizeOptions.width) < Math.abs(ico.width - best.width) ? ico : best
            );
        }

        if (icoInfo.image == null) {
            throw new Error("Bug: sharps-ico found no image in ICO");
        }

        const icoImage = icoInfo.image.png();
        if (sizeOptions?.resizeICO) {
            return icoImage.resize(sizeOptions);
        } else {
            return icoImage;
        }
    } else {
        let image = typeof path !== "string" && "toBuffer" in path ? path : sharp(path);
        if (sizeOptions) {
            image = image.resize(sizeOptions);
        }
        return image;
    }
}

function validDim<T extends Partial<ImageDim>>(meta: T): T & ImageDim {
    if (meta?.width == null || meta?.height == null) {
        throw new Error("Failed getting icon dimensions");
    }
    return meta as T & ImageDim;
}

function emptyImage(dim: ImageDim) {
    return sharp({
        create: {
            width: dim.width,
            height: dim.height,
            channels: 4,
            background: { r: 0, b: 0, g: 0, alpha: 0 }
        }
    });
}

function composeTrayIcon(
    icon: SharpInput,
    iconDim: ImageDim,
    badge: SharpInput,
    badgeDim: ImageDim,
    badgeOptions: Required<BadgeOptions>
): sharp.Sharp {
    let badgeLeft = badgeOptions.left * iconDim.width;
    switch (badgeOptions.anchorX) {
        case "left":
            break;
        case "right":
            badgeLeft -= badgeDim.width;
            break;
        case "center":
            badgeLeft -= badgeDim.width / 2;
            break;
    }
    let badgeTop = badgeOptions.top * iconDim.height;
    switch (badgeOptions.anchorY) {
        case "top":
            break;
        case "bottom":
            badgeTop -= badgeDim.height / 2;
            break;
        case "center":
            badgeTop -= badgeDim.height / 2;
            break;
    }

    badgeTop = Math.round(badgeTop);
    badgeLeft = Math.round(badgeLeft);

    const padding = Math.max(
        0,
        -badgeLeft,
        badgeLeft + badgeDim.width - iconDim.width,
        -badgeTop,
        badgeTop + badgeDim.height - iconDim.height
    );

    return emptyImage({
        width: iconDim.width + 2 * padding,
        height: iconDim.height + 2 * padding
    }).composite([
        {
            input: icon,
            left: padding,
            top: padding
        },
        {
            input: badge,
            left: badgeLeft + padding,
            top: badgeTop + padding
        }
    ]);
}
