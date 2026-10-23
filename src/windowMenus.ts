import { BrowserWindow, app, shell, Menu, MenuItemConstructorOptions } from "electron";
import { createAboutWindow } from "main/about";
import { sendRendererCommand } from "main/ipcCommands";
import { VencordSettings } from "main/settings";
import { clearData } from "main/utils/clearData";
import { downloadVencordFiles } from "main/utils/vencordLoader";
import { IpcCommands } from "shared/IpcEvents";
import { isTruthy } from "shared/utils/guards";

type MenuItemList = Array<MenuItemConstructorOptions | false>;

function createBaseMenuBar(win : BrowserWindow) : MenuItemList{
const isWindows = process.platform === "win32";
    const isDarwin = process.platform === "darwin";
    const wantCtrlQ = !isWindows || VencordSettings.store.winCtrlQ;

    const subMenu = [
        {
            label: "About Vesktop",
            click: createAboutWindow
        },
        {
            label: "Force Update Vencord",
            async click() {
                await downloadVencordFiles();
                app.relaunch();
                app.quit();
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Reset Vesktop",
            async click() {
                await clearData(win);
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Relaunch",
            accelerator: "CmdOrCtrl+Shift+R",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        ...(!isDarwin
            ? []
            : ([
                  {
                      type: "separator"
                  },
                  {
                      label: "Settings",
                      accelerator: "CmdOrCtrl+,",
                      async click() {
                          sendRendererCommand(IpcCommands.NAVIGATE_SETTINGS);
                      }
                  },
                  {
                      type: "separator"
                  },
                  {
                      role: "hide"
                  },
                  {
                      role: "hideOthers"
                  },
                  {
                      role: "unhide"
                  },
                  {
                      type: "separator"
                  }
              ] satisfies MenuItemList)),
        {
            label: "Quit",
            accelerator: wantCtrlQ ? "CmdOrCtrl+Q" : void 0,
            visible: !isWindows,
            role: "quit",
            click() {
                app.quit();
            }
        },
        isWindows && {
            label: "Quit",
            accelerator: "Alt+F4",
            role: "quit",
            click() {
                app.quit();
            }
        },
        // See https://github.com/electron/electron/issues/14742 and https://github.com/electron/electron/issues/5256
        {
            label: "Zoom in (hidden, hack for Qwertz and others)",
            accelerator: "CmdOrCtrl+=",
            role: "zoomIn",
            visible: false
        }
    ] satisfies MenuItemList;

    const menuItems = [
        {
            label: "Vesktop",
            role: "appMenu",
            submenu: subMenu.filter(isTruthy)
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        isDarwin && { role: "windowMenu" }
    ] satisfies MenuItemList;

    return menuItems;
}


export function initMenuBar(win: BrowserWindow) {

    const menuItems = createBaseMenuBar(win);

    const menu = Menu.buildFromTemplate(menuItems.filter(isTruthy));

    Menu.setApplicationMenu(menu);
}

export function initBrowserPopupMenuBar(win: BrowserWindow, url : string) {

    const menuItems = createBaseMenuBar(win);
    menuItems.push(
        {
            label: "Open in browser",
            click() {
                shell.openExternal(url);
            },
        })

    const menu = Menu.buildFromTemplate(menuItems.filter(isTruthy));

    Menu.setApplicationMenu(menu);
}