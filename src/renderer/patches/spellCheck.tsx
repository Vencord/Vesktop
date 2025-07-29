/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch } from "@vencord/types/api/ContextMenu";
import { findStoreLazy } from "@vencord/types/webpack";
import { FluxDispatcher, Menu, useMemo, useStateFromStores } from "@vencord/types/webpack/common";
import { useSettings } from "renderer/settings";

import { addPatch } from "./shared";

let word: string;
let corrections: string[];

const SpellCheckStore = findStoreLazy("SpellcheckStore");

// Make spellcheck suggestions work
addPatch({
    patches: [
        {
            find: ".enableSpellCheck)",
            replacement: {
                // if (isDesktop) { DiscordNative.onSpellcheck(openMenu(props)) } else { e.preventDefault(); openMenu(props) }
                match: /else (.{1,3})\.preventDefault\(\),(.{1,3}\(.{1,3}\))(?<=:(.{1,3})\.enableSpellCheck\).+?)/,
                // ... else { $self.onSlateContext(() => openMenu(props)) }
                replace: "else {$self.onSlateContext($1, $3?.enableSpellCheck, () => $2)}"
            }
        }
    ],

    onSlateContext(e: MouseEvent, hasSpellcheck: boolean | undefined, openMenu: () => void) {
        if (!hasSpellcheck) {
            e.preventDefault();
            openMenu();
            return;
        }

        const cb = (w: string, c: string[]) => {
            VesktopNative.spellcheck.offSpellcheckResult(cb);
            word = w;
            corrections = c;
            openMenu();
        };
        VesktopNative.spellcheck.onSpellcheckResult(cb);
    }
});

addContextMenuPatch("textarea-context", children => {
    const spellCheckEnabled = useStateFromStores([SpellCheckStore], () => SpellCheckStore.isEnabled());
    const hasCorrections = Boolean(word && corrections?.length);

    const availableLanguages = useMemo(VesktopNative.spellcheck.getAvailableLanguages, []);

    const settings = useSettings();
    const spellCheckLanguages = (settings.spellCheckLanguages ??= [...new Set(navigator.languages)]);

    const pasteSectionIndex = children.findIndex(c => c?.props?.children?.some?.(c => c?.props?.id === "paste"));

    children.splice(
        pasteSectionIndex === -1 ? children.length : pasteSectionIndex,
        0,
        <Menu.MenuGroup key="vcd-spellcheck-group">
            {hasCorrections && (
                <>
                    {corrections.map(c => (
                        <Menu.MenuItem
                            key={`vcd-spellcheck-suggestion-${c}`}
                            id={`vcd-spellcheck-suggestion-${c}`}
                            label={c}
                            action={() => VesktopNative.spellcheck.replaceMisspelling(c)}
                        />
                    ))}
                    <Menu.MenuSeparator key="vcd-spellcheck-separator-1" />
                    <Menu.MenuItem
                        key="vcd-spellcheck-learn"
                        id="vcd-spellcheck-learn"
                        label={`Add "${word}" to dictionary`}
                        action={() => VesktopNative.spellcheck.addToDictionary(word)}
                    />
                    <Menu.MenuSeparator key="vcd-spellcheck-separator-2" />
                </>
            )}

            {/* Primary toggle - directly accessible for best UX */}
            <Menu.MenuCheckboxItem
                key="vcd-spellcheck-enabled"
                id="vcd-spellcheck-enabled"
                label="Enable Spellcheck"
                checked={spellCheckEnabled}
                action={() => {
                    FluxDispatcher.dispatch({ type: "SPELLCHECK_TOGGLE" });
                }}
            />

            {/* Language settings in submenu - less frequently used */}
            <Menu.MenuItem
                key="vcd-spellcheck-languages"
                id="vcd-spellcheck-languages"
                label="Spellcheck Languages"
                disabled={!spellCheckEnabled}
            >
                {availableLanguages.map(lang => {
                    const isEnabled = spellCheckLanguages.includes(lang);
                    return (
                        <Menu.MenuCheckboxItem
                            key={`vcd-spellcheck-lang-${lang}`}
                            id={`vcd-spellcheck-lang-${lang}`}
                            label={lang}
                            checked={isEnabled}
                            disabled={!isEnabled && spellCheckLanguages.length >= 5}
                            action={() => {
                                const newSpellCheckLanguages = spellCheckLanguages.filter(l => l !== lang);
                                if (newSpellCheckLanguages.length === spellCheckLanguages.length) {
                                    newSpellCheckLanguages.push(lang);
                                }

                                settings.spellCheckLanguages = newSpellCheckLanguages;
                            }}
                        />
                    );
                })}
            </Menu.MenuItem>
        </Menu.MenuGroup>
    );
});
