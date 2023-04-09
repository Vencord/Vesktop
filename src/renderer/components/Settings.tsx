import { getValueAndOnChange, useSettings } from "renderer/settings";
import { Common, Util } from "../vencord";

import "./settings.css";

const { Margins } = Util;

export default function SettingsUi() {
    const Settings = useSettings();
    const { Forms: { FormSection, FormText, FormDivider, FormSwitch, FormTitle }, Text, Select, Button } = Common;

    return (
        <FormSection>
            <Text variant="heading-lg/semibold" style={{ color: "var(--header-primary)" }} tag="h2">
                Vencord Desktop Settings
            </Text>

            <FormTitle className={Margins.top16}>
                Discord Branch
            </FormTitle>
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

            <FormDivider className={Margins.top16 + " " + Margins.bottom16} />

            <FormSwitch
                {...getValueAndOnChange("openLinksWithElectron")}
                note={"This will open links in a new window instead of your WebBrowser"}
            >
                Open Links in app
            </FormSwitch>

            <FormTitle>Vencord Desktop Location</FormTitle>
            <FormText>
                Files are loaded from
                {" "}
                {Settings.vencordDir
                    ? (
                        <a
                            href="about:blank"
                            onClick={e => {
                                e.preventDefault();
                                VencordDesktopNative.fileManager.showItemInFolder(Settings.vencordDir!);
                            }}
                        >
                            {Settings.vencordDir}
                        </a>
                    )
                    : "the default location"
                }
            </FormText>
            <div className="vcd-location-btns">
                <Button
                    size={Button.Sizes.SMALL}
                    onClick={async () => {
                        const choice = await VencordDesktopNative.fileManager.selectVencordDir();
                        switch (choice) {
                            case "cancelled":
                            case "invalid":
                                // TODO
                                return;
                        }
                        Settings.vencordDir = choice;
                    }}
                >
                    Change
                </Button>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.RED}
                    onClick={() => Settings.vencordDir = void 0}
                >
                    Reset
                </Button>
            </div>
        </FormSection>
    );
}
