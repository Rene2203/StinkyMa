import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Autovervollständigung im Editor (W8.5): Nach einer kurzen Tipppause am Ende eines Absatzes wird ein Vorschlag
// geholt und als grauer Text hinter dem Cursor gezeigt. Tab oder → übernimmt, Esc oder Weitertippen verwirft.
// Der Vorschlag ist nur eine Anzeige (Dekoration) – im Text und im gespeicherten Entwurf steht er erst nach Übernahme.

/** Holt einen Vorschlag für die Stelle (Text davor/danach) – `null`: keiner. */
export type Suggest = (before: string, after: string) => Promise<string | null>;

interface Ghost {
  text: string;
  pos: number;
}

export const ghostKey = new PluginKey<Ghost | null>("ghostText");

export interface GhostTextOptions {
  suggest: Suggest | null;
  /** Abbrechen einer laufenden Anfrage (weitergetippt) */
  cancel: (() => void) | null;
  delayMs: number;
}

export const GhostText = Extension.create<GhostTextOptions>({
  name: "ghostText",

  addOptions() {
    return { suggest: null, cancel: null, delayMs: 300 };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    let pending = false;

    return [
      new Plugin<Ghost | null>({
        key: ghostKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(ghostKey) as Ghost | null | undefined;
            if (meta !== undefined) return meta;
            return tr.docChanged || tr.selectionSet ? null : value;
          },
        },
        props: {
          decorations(state) {
            const ghost = ghostKey.getState(state);
            if (!ghost) return null;
            const widget = Decoration.widget(
              ghost.pos,
              () => {
                const span = document.createElement("span");
                span.className = "ghost-text";
                span.textContent = ghost.text;
                span.setAttribute("data-testid", "ghost-text");
                span.setAttribute("aria-hidden", "true");
                return span;
              },
              { side: 1, key: `ghost-${ghost.text}` },
            );
            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            const ghost = ghostKey.getState(view.state);
            if (!ghost) return false;
            const atGhost = view.state.selection.empty && view.state.selection.from === ghost.pos;
            if (atGhost && ((event.key === "Tab" && !event.shiftKey && !event.ctrlKey && !event.altKey) || (event.key === "ArrowRight" && !event.shiftKey))) {
              view.dispatch(view.state.tr.insertText(ghost.text, ghost.pos).setMeta(ghostKey, null));
              return true;
            }
            if (event.key === "Escape") {
              // Erst den Vorschlag schließen, nicht gleich den Editor
              view.dispatch(view.state.tr.setMeta(ghostKey, null));
              event.stopPropagation();
              return true;
            }
            return false;
          },
        },
        view() {
          return {
            update(view, previous) {
              const docChanged = !view.state.doc.eq(previous.doc);
              if (!docChanged && view.state.selection.eq(previous.selection)) return;
              // Jede Eingabe oder Cursorbewegung: alte Anfrage verwerfen
              clearTimeout(timer);
              request++;
              if (pending) {
                pending = false;
                options.cancel?.();
              }
              // Neuer Vorschlag nur nach Tippen, am Ende eines Absatzes, ohne Markierung
              if (!docChanged || !options.suggest) return;
              const selection = view.state.selection;
              if (!selection.empty || selection.$from.parentOffset !== selection.$from.parent.content.size) return;
              const id = request;
              timer = setTimeout(() => {
                const suggest = options.suggest;
                if (id !== request || !suggest || view.isDestroyed) return;
                const state = view.state;
                const pos = state.selection.from;
                const before = state.doc.textBetween(Math.max(0, pos - 1500), pos, "\n", " ");
                const after = state.doc.textBetween(pos, Math.min(state.doc.content.size, pos + 1500), "\n", " ");
                pending = true;
                void suggest(before, after)
                  .catch(() => null)
                  .then((text) => {
                    if (id !== request) return;
                    pending = false;
                    if (!text || view.isDestroyed || view.state.selection.from !== pos || !view.state.selection.empty) return;
                    view.dispatch(view.state.tr.setMeta(ghostKey, { text, pos }).setMeta("addToHistory", false));
                  });
              }, options.delayMs);
            },
            destroy() {
              clearTimeout(timer);
              request++;
              if (pending) options.cancel?.();
            },
          };
        },
      }),
    ];
  },
});
