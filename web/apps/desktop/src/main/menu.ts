import { Menu, type MenuItemConstructorOptions } from "electron";

/** Anwendungsmenü (Alt blendet es unter Windows ein). Deutsch, sofern Windows nicht auf Englisch steht. */
export function buildMenu(systemLocale: string): Menu {
  const de = !systemLocale.toLowerCase().startsWith("en");
  const template: MenuItemConstructorOptions[] = [
    {
      label: de ? "&Datei" : "&File",
      submenu: [{ role: "quit", label: de ? "Beenden" : "Quit" }],
    },
    {
      label: de ? "&Bearbeiten" : "&Edit",
      submenu: [
        { role: "undo", label: de ? "Rückgängig" : "Undo" },
        { role: "redo", label: de ? "Wiederholen" : "Redo" },
        { type: "separator" },
        { role: "cut", label: de ? "Ausschneiden" : "Cut" },
        { role: "copy", label: de ? "Kopieren" : "Copy" },
        { role: "paste", label: de ? "Einfügen" : "Paste" },
        { role: "selectAll", label: de ? "Alles auswählen" : "Select All" },
      ],
    },
    {
      label: de ? "&Ansicht" : "&View",
      submenu: [
        { role: "reload", label: de ? "Neu laden" : "Reload" },
        { role: "toggleDevTools", label: de ? "Entwicklerwerkzeuge" : "Developer Tools" },
        { type: "separator" },
        { role: "resetZoom", label: de ? "Originalgröße" : "Actual Size" },
        { role: "zoomIn", label: de ? "Vergrößern" : "Zoom In" },
        { role: "zoomOut", label: de ? "Verkleinern" : "Zoom Out" },
        { type: "separator" },
        { role: "togglefullscreen", label: de ? "Vollbild" : "Full Screen" },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
