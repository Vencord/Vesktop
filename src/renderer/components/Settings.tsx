import { getValueAndOnChange, useSettings } from "renderer/settings";
import { Common } from "../vencord";

export default function SettingsUi() {
    const Settings = useSettings();
    const { Forms: { FormSection, FormText, FormDivider, FormSwitch, FormTitle }, Text, Select } = Common;

    return (
        <FormSection>
            <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }} tag="h2">
                Vencord Desktop Settings
            </Text>

            <FormTitle>Discord Branch</FormTitle>
            <Select
                placeholder="Stable"
                options={[
                    { label: "Stable", value: "stable", default: true },
                    { label: "Canary", value: "canary" },
                    { label: "PTB", value: "ptb" },
                ]}
                closeOnSelect={true}
                select={v => Settings.discordBranch = v}
                isSelected={v => v === Settings.discordBranch}
                serialize={s => s}
            />

            <FormSwitch
                {...getValueAndOnChange("openLinksWithElectron")}
                note={"This will open links in a new window instead of your WebBrowser"}
            >
                Open Links in app
            </FormSwitch>
        </FormSection>
    );
}
