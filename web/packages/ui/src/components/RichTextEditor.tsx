import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUi } from "../context.js";

/** Schriften, die auch beim Empfänger vorhanden sind (sonst fällt das Mailprogramm auf die nächste zurück). */
export const fontFamilies: { label: string; value: string }[] = [
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Avenir", value: '"Avenir Next", Avenir, "Segoe UI", sans-serif' },
  { label: "Calibri", value: "Calibri, Carlito, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Segoe UI", value: '"Segoe UI", system-ui, sans-serif' },
  { label: "Tahoma", value: "Tahoma, Verdana, sans-serif" },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
  { label: "Trebuchet MS", value: '"Trebuchet MS", sans-serif' },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
];

/** Größen in Punkt wie in Outlook/Word; Standard ist 11 pt. */
export const fontSizes = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "36"];

export interface RichTextValue {
  html: string;
  text: string;
}

/**
 * Formatierbares Eingabefeld für Mails (TipTap/ProseMirror): Schriftart, -größe, Fett, Kursiv, Unterstrichen,
 * Durchgestrichen, Farbe, Aufzählung, Nummerierung, Ausrichtung, Zitat, Link. Tastenkürzel wie gewohnt (Strg+B/I/U).
 */
export function RichTextEditor({
  initialHtml,
  focus,
  onChange,
  onReady,
  testId = "compose-body",
  placeholder,
  label,
}: {
  initialHtml: string;
  testId?: string;
  placeholder?: string;
  label?: string;
  /** „start“ bei Antworten (über dem Zitat), sonst kein Fokus. */
  focus: "start" | null;
  onChange: (value: RichTextValue) => void;
  onReady?: (editor: Editor) => void;
}) {
  const { t } = useUi();
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
      }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      TextAlign.configure({ types: ["paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? t("compose.body") }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: { "data-testid": testId, "aria-label": label ?? t("compose.body"), class: "composer-editor", spellcheck: "true" },
    },
    onUpdate: ({ editor: e }) => onChange({ html: e.getHTML(), text: e.getText({ blockSeparator: "\n" }) }),
  });

  useEffect(() => {
    if (!editor) return;
    onReady?.(editor);
    // Der Editor kann beim schnellen Neuaufbau (Composer öffnet mit vorbefülltem Text) schon wieder abgebaut sein
    if (focus === "start" && !editor.isDestroyed) editor.commands.focus("start");
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="rich-editor">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="composer-body" />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useUi();
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      link: e.isActive("link"),
      alignCenter: e.isActive({ textAlign: "center" }),
      alignRight: e.isActive({ textAlign: "right" }),
      fontFamily: (e.getAttributes("textStyle").fontFamily as string | undefined) ?? "",
      fontSize: (e.getAttributes("textStyle").fontSize as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? "",
    }),
  });
  const [linkOpen, setLinkOpen] = useState(false);
  const chain = () => editor.chain().focus();
  const size = state.fontSize.replace(/pt$/, "");

  return (
    <div className="format-bar" role="toolbar" aria-label={t("format.toolbar")} data-testid="format-bar">
      <select
        className="format-select font"
        aria-label={t("format.font")}
        title={t("format.font")}
        value={state.fontFamily}
        data-testid="format-font"
        onChange={(e) => (e.target.value ? chain().setFontFamily(e.target.value).run() : chain().unsetFontFamily().run())}
      >
        <option value="">{t("format.defaultFont")}</option>
        {fontFamilies.map((f) => (
          <option key={f.label} value={f.value} style={{ fontFamily: f.value }}>
            {f.label}
          </option>
        ))}
        {state.fontFamily && !fontFamilies.some((f) => f.value === state.fontFamily) && <option value={state.fontFamily}>{state.fontFamily}</option>}
      </select>
      <select
        className="format-select size"
        aria-label={t("format.size")}
        title={t("format.size")}
        value={size}
        data-testid="format-size"
        onChange={(e) => (e.target.value ? chain().setFontSize(`${e.target.value}pt`).run() : chain().unsetFontSize().run())}
      >
        <option value="">11</option>
        {fontSizes.filter((s) => s !== "11").map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
        {size && !fontSizes.includes(size) && <option value={size}>{size}</option>}
      </select>
      <Separator />
      <FormatButton label={`${t("format.bold")} (Strg+B)`} active={state.bold} onClick={() => chain().toggleBold().run()} testId="format-bold">
        <Bold size={16} />
      </FormatButton>
      <FormatButton label={`${t("format.italic")} (Strg+I)`} active={state.italic} onClick={() => chain().toggleItalic().run()} testId="format-italic">
        <Italic size={16} />
      </FormatButton>
      <FormatButton label={`${t("format.underline")} (Strg+U)`} active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <UnderlineIcon size={16} />
      </FormatButton>
      <FormatButton label={t("format.strike")} active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={16} />
      </FormatButton>
      <label className="format-button color" title={t("format.color")}>
        <Baseline size={16} aria-hidden="true" style={{ color: state.color || undefined }} />
        <input
          type="color"
          aria-label={t("format.color")}
          value={/^#[0-9a-f]{6}$/i.test(state.color) ? state.color : "#000000"}
          onChange={(e) => chain().setColor(e.target.value).run()}
        />
      </label>
      <Separator />
      <FormatButton label={t("format.bulletList")} active={state.bulletList} onClick={() => chain().toggleBulletList().run()} testId="format-bullets">
        <List size={16} />
      </FormatButton>
      <FormatButton label={t("format.orderedList")} active={state.orderedList} onClick={() => chain().toggleOrderedList().run()} testId="format-numbers">
        <ListOrdered size={16} />
      </FormatButton>
      <FormatButton label={t("format.quote")} active={state.blockquote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote size={16} />
      </FormatButton>
      <Separator />
      <FormatButton label={t("format.alignLeft")} active={!state.alignCenter && !state.alignRight} onClick={() => chain().unsetTextAlign().run()}>
        <AlignLeft size={16} />
      </FormatButton>
      <FormatButton label={t("format.alignCenter")} active={state.alignCenter} onClick={() => chain().setTextAlign("center").run()}>
        <AlignCenter size={16} />
      </FormatButton>
      <FormatButton label={t("format.alignRight")} active={state.alignRight} onClick={() => chain().setTextAlign("right").run()}>
        <AlignRight size={16} />
      </FormatButton>
      <Separator />
      <FormatButton label={t("format.link")} active={state.link || linkOpen} onClick={() => setLinkOpen(!linkOpen)} testId="format-link">
        <LinkIcon size={16} />
      </FormatButton>
      <FormatButton label={t("format.clear")} active={false} onClick={() => chain().unsetAllMarks().unsetTextAlign().run()}>
        <RemoveFormatting size={16} />
      </FormatButton>
      {linkOpen && <LinkField editor={editor} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

/** Link setzen/entfernen – eigenes Feld statt prompt() (gibt es in Electron nicht). */
function LinkField({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useUi();
  const [url, setUrl] = useState((editor.getAttributes("link").href as string | undefined) ?? "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const apply = () => {
    const value = url.trim();
    if (!value) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      const href = /^(https?:|mailto:)/i.test(value) ? value : value.includes("@") && !value.includes("/") ? `mailto:${value}` : `https://${value}`;
      const chain = editor.chain().focus().extendMarkRange("link");
      if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: value, marks: [{ type: "link", attrs: { href } }] }).run();
      else chain.setLink({ href }).run();
    }
    onClose();
  };

  return (
    <div className="link-field">
      <input
        ref={input}
        value={url}
        placeholder="https://…"
        aria-label={t("format.linkUrl")}
        data-testid="format-link-url"
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      />
      <button type="button" onClick={apply}>{t("format.linkApply")}</button>
    </div>
  );
}

function FormatButton({ label, active, onClick, children, testId }: { label: string; active: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      className={`format-button${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid={testId}
      // Fokus im Text lassen, damit die Auswahl erhalten bleibt
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Separator() {
  return <span className="format-separator" aria-hidden="true" />;
}
