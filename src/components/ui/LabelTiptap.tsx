"use client";

// WYSIWYG-Editor auf Basis von TipTap CORE (@tiptap/react) mit EIGENER Toolbar
// (die vorgefertigten TipTap-UI-Components sind noch nicht voll React-19-fähig;
// das Core-Paket schon). Gibt HTML via editor.getHTML() im onUpdate zurück.
//
// Next.js App Router: useEditor mit immediatelyRender:false (SSR-Hydration) in
// einer "use client"-Komponente. Schriftgröße via FontSize (@tiptap/extension-
// text-style) → span[style="font-size:…px"] (KEINE Klassen → passt zur
// sanitize-html-Allowlist). TipTap: Fett=<strong>, Kursiv=<em>.

import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { Bold, Italic, List, ListOrdered } from "lucide-react";

type Toolbar = "voll" | "reduziert";

// Schriftgrößen als px → span[style="font-size:…px"].
const FONT_SIZES = [
  { label: "Klein",     val: "12px" },
  { label: "Normal",    val: "16px" },
  { label: "Groß",      val: "22px" },
  { label: "Sehr groß", val: "30px" },
];

const EDITOR_CSS = `
.label-tiptap .tiptap { min-height: 200px; padding: 12px 14px; outline: none; }
.label-tiptap .tiptap:focus { outline: none; }
.label-tiptap .tiptap > :first-child { margin-top: 0; }
.label-tiptap .tiptap p  { margin: 0 0 0.5em; }
.label-tiptap .tiptap h2 { font-size: 1.4em; font-weight: bold; margin: 0 0 0.4em; }
.label-tiptap .tiptap h3 { font-size: 1.15em; font-weight: bold; margin: 0 0 0.3em; }
.label-tiptap .tiptap ul { list-style: disc;    padding-left: 1.5em; margin: 0 0 0.5em; }
.label-tiptap .tiptap ol { list-style: decimal; padding-left: 1.5em; margin: 0 0 0.5em; }
.label-tiptap .tiptap strong { font-weight: bold; }
.label-tiptap .tiptap em { font-style: italic; }
`;

const btn =
  "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-lg border text-sm font-semibold transition-colors";
const btnOff = "border-[#ced4da] dark:border-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042]";
const btnOn  = "bg-[#0064d2]/10 border-[#0064d2] text-[#0064d2] dark:text-[#45bdff]";

export default function LabelTiptap({
  html, onHtmlChange, toolbar,
}: {
  html:         string;
  onHtmlChange: (html: string) => void;
  toolbar:      Toolbar;
}) {
  const editor = useEditor({
    immediatelyRender: false,                       // App-Router-SSR-Hydration
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      TextStyle,
      FontSize,
    ],
    content: html,
    onUpdate: ({ editor }) => onHtmlChange(editor.getHTML()),
    editorProps: { attributes: { "aria-label": "Label-Inhalt bearbeiten", role: "textbox" } },
  });

  // Toolbar-Aktiv-Zustände aktuell halten (re-render bei jeder Transaktion).
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => force((x) => x + 1);
    editor.on("transaction", update);
    return () => { editor.off("transaction", update); };
  }, [editor]);

  // Externe HTML-Änderungen übernehmen (Vorlage laden / Leeren) — ohne Loop:
  // nur setzen, wenn es sich vom aktuellen Editor-HTML unterscheidet.
  useEffect(() => {
    if (!editor) return;
    if (html !== editor.getHTML()) {
      editor.commands.setContent(html || "", { emitUpdate: false });
    }
  }, [html, editor]);

  if (!editor) {
    return (
      <div className="min-h-[200px] flex items-center justify-center rounded-xl border border-[#ced4da] dark:border-[#3e4042] text-sm text-[#90939a]">
        Editor lädt…
      </div>
    );
  }

  const aktGroesse: string = editor.getAttributes("textStyle").fontSize ?? "";

  function setGroesse(val: string) {
    if (!editor) return;
    if (val) editor.chain().focus().setFontSize(val).run();
    else     editor.chain().focus().unsetFontSize().run();
  }

  return (
    <div className="label-tiptap rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#18191a] overflow-hidden">
      <style>{EDITOR_CSS}</style>

      {/* Eigene Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#ced4da] dark:border-[#3e4042] p-2">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${btn} ${editor.isActive("bold") ? btnOn : btnOff}`}
          aria-pressed={editor.isActive("bold")}
          aria-label="Fett" title="Fett"
        >
          <Bold size={16} aria-hidden />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${btn} ${editor.isActive("italic") ? btnOn : btnOff}`}
          aria-pressed={editor.isActive("italic")}
          aria-label="Kursiv" title="Kursiv"
        >
          <Italic size={16} aria-hidden />
        </button>

        <select
          aria-label="Schriftgröße"
          value={aktGroesse}
          onChange={(e) => setGroesse(e.target.value)}
          className="h-9 px-2 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-white dark:bg-[#242526] text-sm font-semibold text-[#65676b] dark:text-[#b0b3b8]"
        >
          <option value="">Schriftgröße</option>
          {FONT_SIZES.map((f) => (
            <option key={f.val} value={f.val}>{f.label}</option>
          ))}
        </select>

        {toolbar === "voll" && (
          <>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`${btn} ${editor.isActive("bulletList") ? btnOn : btnOff}`}
              aria-pressed={editor.isActive("bulletList")}
              aria-label="Aufzählung" title="Aufzählung"
            >
              <List size={16} aria-hidden />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`${btn} ${editor.isActive("orderedList") ? btnOn : btnOff}`}
              aria-pressed={editor.isActive("orderedList")}
              aria-label="Nummerierte Liste" title="Nummerierte Liste"
            >
              <ListOrdered size={16} aria-hidden />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`${btn} ${editor.isActive("heading", { level: 2 }) ? btnOn : btnOff}`}
              aria-pressed={editor.isActive("heading", { level: 2 })}
              title="Überschrift"
            >
              H2
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`${btn} ${editor.isActive("heading", { level: 3 }) ? btnOn : btnOff}`}
              aria-pressed={editor.isActive("heading", { level: 3 })}
              title="Unterüberschrift"
            >
              H3
            </button>
          </>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
