import { addAssetsCar } from "./addAssetsCar.mjs";

export default async function afterPack(context) {
    await addAssetsCar(context);
}
