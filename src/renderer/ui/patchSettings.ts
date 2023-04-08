import { monkeyPatch } from "../../shared/utils/monkeyPatch";
import { Common, plugins } from "../vencord";
import Settings from "./Settings";

monkeyPatch(plugins.Settings, "makeSettingsCategories", function (this: unknown, original, { ID }: { ID: Record<string, unknown>; }) {
    const cats = original.call(this, { ID });
    cats.splice(1, 0, {
        section: "VencordDesktop",
        label: "Desktop Settings",
        element: Settings,
        onClick: () => Common.SettingsRouter.open("VencordDesktop")
    });

    return cats;
});
