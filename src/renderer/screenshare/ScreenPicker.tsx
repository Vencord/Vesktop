/*
 * SPDX-License-Identifier: GPL-3.0
 * Vencord Desktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 */

import "./styles.css";

import { Common, Util } from "renderer/vencord";

const { Modals } = Util;

type Sources = Awaited<ReturnType<(typeof VencordDesktopNative)["capturer"]["getSources"]>>;

export function openScreenPicker(screens: Sources) {
    return new Promise<string>((resolve, reject) => {
        const key = Modals.openModal(props => (
            <ModalComponent
                screens={screens}
                modalProps={props}
                submit={resolve}
                close={() => {
                    Modals.closeModal(key);
                    reject(new Error("Aborted"));
                }}
            />
        ));
    });
}

function ModalComponent({
    screens,
    modalProps,
    submit,
    close
}: {
    screens: Sources;
    modalProps: any;
    submit: (id: string) => void;
    close: () => void;
}) {
    const [selected, setSelected] = Common.React.useState(screens[0]?.id);

    return (
        <Modals.ModalRoot {...modalProps}>
            <Modals.ModalHeader>
                <Common.Forms.FormTitle tag="h2">Screen Picker</Common.Forms.FormTitle>
                <Modals.ModalCloseButton onClick={close} />
            </Modals.ModalHeader>

            <Modals.ModalContent>
                <div className="vcd-screen-picker-grid">
                    {screens.map(({ id, name, url }) => (
                        <label key={id} className={selected === id ? "vcd-screen-picker-selected" : ""}>
                            <input type="radio" name="screen" value={id} onChange={() => setSelected(id)} />

                            <img src={url} alt="" />
                            <Common.Forms.Text variant="text-sm/normal">{name}</Common.Forms.Text>
                        </label>
                    ))}
                </div>
            </Modals.ModalContent>

            <Modals.ModalFooter>
                <Common.Button
                    disabled={!selected}
                    onClick={() => {
                        submit(selected);
                        close();
                    }}
                >
                    Go Live
                </Common.Button>
                <Common.Button color={Common.Button.Colors.TRANSPARENT} onClick={close}>
                    Cancel
                </Common.Button>
            </Modals.ModalFooter>
        </Modals.ModalRoot>
    );
}
