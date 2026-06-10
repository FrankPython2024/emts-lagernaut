"use client";

// Reiner CKEditor-5-Client (Classic). Wird NUR via dynamic import mit
// { ssr: false } geladen (greift auf window/document zu). Gibt HTML als String
// über onChange zurück — passend zur Sanitize-Allowlist (sanitizeSchrank).
//
// Wichtig:
//   • licenseKey: 'GPL'  → seit CKEditor 5 v44 Pflicht (kostenlose GPL-Nutzung)
//   • fontSize.supportAllValues = true → INLINE-Größen span[style="font-size:…px"]
//     statt benannter Klassen (kommt so durch die sanitize-html-Allowlist)
//   • heading nur h2/h3 (kein h1) — deckt die Allowlist ab
//   • Italic von CKEditor = <i> → wird serverseitig per transformTags auf <em>
//     gemappt (wie bisher)

import { CKEditor } from "@ckeditor/ckeditor5-react";
import {
  ClassicEditor,
  Essentials,
  Paragraph,
  Bold,
  Italic,
  FontSize,
  List,
  Heading,
} from "ckeditor5";
import "ckeditor5/ckeditor5.css";

export type CkToolbar = "voll" | "reduziert";

// "voll" (Schrank 15×12): bold, italic, fontSize, Listen, Überschrift
// "reduziert" (Freitext 55×30): bold, italic, fontSize
const TOOLBAR_VOLL = ["bold", "italic", "fontSize", "|", "bulletedList", "numberedList", "|", "heading"];
const TOOLBAR_REDUZIERT = ["bold", "italic", "fontSize"];

type Props = {
  value:    string;
  onChange: (html: string) => void;
  toolbar:  CkToolbar;
};

export default function CKEditorClient({ value, onChange, toolbar }: Props) {
  return (
    <CKEditor
      editor={ClassicEditor}
      data={value}
      config={{
        licenseKey: "GPL",
        plugins: [Essentials, Paragraph, Bold, Italic, FontSize, List, Heading],
        toolbar: {
          items: toolbar === "reduziert" ? TOOLBAR_REDUZIERT : TOOLBAR_VOLL,
        },
        fontSize: {
          // INLINE-Größen (px) als span[style] — KEINE benannten Klassen.
          supportAllValues: true,
          options: [9, 11, 12, "default", 14, 18, 24, 30],
        },
        heading: {
          options: [
            { model: "paragraph", title: "Normaler Text", class: "ck-heading_paragraph" },
            { model: "heading2", view: "h2", title: "Überschrift", class: "ck-heading_heading2" },
            { model: "heading3", view: "h3", title: "Unterüberschrift", class: "ck-heading_heading3" },
          ],
        },
      }}
      onChange={(_evt, editor) => onChange(editor.getData())}
    />
  );
}
