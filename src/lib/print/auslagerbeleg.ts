// ── Auslagerbeleg für Abgaben an andere Niederlassungen ─────────────────────
// A4-Dokument, das der Sendung beiliegt: Absender, Empfänger, Positionen mit
// Einzelpreis und Summe. Gleiche bewährte Mechanik wie die übrigen Drucke
// (window.open SYNCHRON → Popup-Blocker-sicher, @page + Auto-Print).
//
// Beleg-Nummer: bewusst NICHT über `naechsteBelegNr` (Redis-Zähler). Dort käme
// bei jedem Nachdruck eine neue Nummer heraus — ein Lieferschein muss aber
// nachdruckbar bleiben, ohne dass sich die Nummer ändert. Deshalb wird sie fest
// aus der Buchungs-Id abgeleitet: AN-<Jahr>-<Id>.

export type BelegPosition = {
  bezeichnung: string;
  kategorie:   string;
  menge:       number;
  preis:       number | null; // null = kein Preis hinterlegt
};

export type AuslagerbelegDaten = {
  belegNr:     string;
  datum:       Date | string;
  mitarbeiter: string;
  absender:    { name: string; adresse?: string | null };
  empfaenger:  string;
  positionen:  BelegPosition[];
  notiz?:      string | null;
};

/** Beleg-Nummer aus der Buchung ableiten — stabil über Nachdrucke hinweg. */
export function belegNrFuerAbgabe(buchungId: number, datum: Date | string): string {
  const jahr = new Date(datum).getFullYear();
  return `AN-${jahr}-${String(buchungId).padStart(5, "0")}`;
}

const euro = (n: number) => n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const PRINT_SCRIPT = `<script>(function(){
  var done=false;
  function p(){ if(done)return; done=true; window.focus(); window.print(); }
  if(document.readyState==='complete'){ p(); } else { window.addEventListener('load',p); }
  setTimeout(p, 3000);
})();</script>`;

/**
 * Baut das fertige Beleg-Dokument. Getrennt vom Drucken, damit sich das Layout
 * ohne Browser prüfen lässt (dieselbe Funktion, kein Nachbau, der driften kann).
 */
export function belegHtml(d: AuslagerbelegDaten): string {
  const datum = new Date(d.datum).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  const gesamt = d.positionen.reduce(
    (s, p) => s + (p.preis != null ? p.menge * p.preis : 0), 0,
  );
  const ohnePreis = d.positionen.reduce((s, p) => s + (p.preis == null ? p.menge : 0), 0);
  const stueckGesamt = d.positionen.reduce((s, p) => s + p.menge, 0);

  const zeilen = d.positionen.map((p) => `
    <tr>
      <td>
        <div class="bez">${escapeHtml(p.bezeichnung)}</div>
        <div class="kat">${escapeHtml(p.kategorie)}</div>
      </td>
      <td class="num">${p.menge.toLocaleString("de-DE")}</td>
      <td class="num">${p.preis != null ? euro(p.preis) : "—"}</td>
      <td class="num stark">${p.preis != null ? euro(p.menge * p.preis) : "—"}</td>
    </tr>`).join("");

  const css = `
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0;
           -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .kopf { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #202F61; padding-bottom: 10px; margin-bottom: 18px; }
    .titel { font-size: 24px; font-weight: 800; color: #202F61; margin: 0; }
    .untertitel { font-size: 12px; color: #555; margin-top: 2px; }
    .meta { text-align: right; font-size: 12px; line-height: 1.6; }
    .meta .nr { font-size: 16px; font-weight: 800; color: #202F61; }
    .adressen { display: flex; gap: 24px; margin-bottom: 22px; }
    .adresse { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: 10px 12px; }
    .adresse h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .06em;
                  color: #666; margin: 0 0 4px; }
    .adresse .wert { font-size: 15px; font-weight: 700; }
    .adresse .zusatz { font-size: 12px; color: #555; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em;
         color: #666; border-bottom: 2px solid #202F61; padding: 0 6px 6px; }
    th.num, td.num { text-align: right; }
    td { padding: 8px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top;
         font-variant-numeric: tabular-nums; }
    .bez { font-size: 14px; font-weight: 600; }
    .kat { font-size: 11px; color: #666; }
    .stark { font-weight: 700; }
    .summe { display: flex; justify-content: flex-end; }
    .summe table { width: auto; min-width: 240px; }
    .summe td { border: none; padding: 3px 6px; font-size: 14px; }
    .summe .gesamt td { border-top: 2px solid #202F61; font-size: 17px; font-weight: 800;
                        color: #202F61; padding-top: 8px; }
    .hinweis { margin-top: 10px; font-size: 11px; color: #a06800; }
    .notiz { margin-top: 18px; font-size: 12px; }
    .notiz h3 { font-size: 10px; text-transform: uppercase; color: #666; margin: 0 0 3px; }
    .unterschriften { display: flex; gap: 40px; margin-top: 48px; }
    .unterschrift { flex: 1; border-top: 1px solid #999; padding-top: 5px;
                    font-size: 11px; color: #555; }
    .fuss { margin-top: 26px; font-size: 10px; color: #888; text-align: center;
            border-top: 1px solid #e3e3e3; padding-top: 8px; }
  `;

  const body = `
    <div class="kopf">
      <div>
        <h1 class="titel">Auslagerbeleg</h1>
        <div class="untertitel">Materialabgabe an eine andere Niederlassung</div>
      </div>
      <div class="meta">
        <div class="nr">${escapeHtml(d.belegNr)}</div>
        <div>Datum: ${datum}</div>
        <div>Erfasst von: ${escapeHtml(d.mitarbeiter)}</div>
      </div>
    </div>

    <div class="adressen">
      <div class="adresse">
        <h2>Von</h2>
        <div class="wert">${escapeHtml(d.absender.name)}</div>
        ${d.absender.adresse ? `<div class="zusatz">${escapeHtml(d.absender.adresse)}</div>` : ""}
      </div>
      <div class="adresse">
        <h2>An</h2>
        <div class="wert">${escapeHtml(d.empfaenger)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Artikel</th>
          <th class="num">Stück</th>
          <th class="num">Einzelpreis</th>
          <th class="num">Summe</th>
        </tr>
      </thead>
      <tbody>${zeilen}</tbody>
    </table>

    <div class="summe">
      <table>
        <tr><td>Positionen</td><td class="num">${d.positionen.length}</td></tr>
        <tr><td>Stück gesamt</td><td class="num">${stueckGesamt.toLocaleString("de-DE")}</td></tr>
        <tr class="gesamt"><td>Warenwert</td><td class="num">${euro(gesamt)}</td></tr>
      </table>
    </div>

    ${ohnePreis > 0 ? `<div class="hinweis">
      Hinweis: ${ohnePreis.toLocaleString("de-DE")} Stück ohne hinterlegten Preis —
      im ausgewiesenen Warenwert nicht enthalten.
    </div>` : ""}

    ${d.notiz ? `<div class="notiz"><h3>Notiz</h3>${escapeHtml(d.notiz)}</div>` : ""}

    <div class="unterschriften">
      <div class="unterschrift">Datum, Unterschrift ausgebende Stelle</div>
      <div class="unterschrift">Datum, Unterschrift Empfänger</div>
    </div>

    <div class="fuss">EMTS Lagernaut · erstellt am ${new Date().toLocaleString("de-DE")}</div>
  `;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(d.belegNr)}</title>`
    + `<style>${css}</style></head><body>${body}${PRINT_SCRIPT}</body></html>`;
}

export function printAuslagerbeleg(d: AuslagerbelegDaten): void {
  // Fenster SYNCHRON öffnen — sonst greift der Popup-Blocker.
  const w = window.open("", "_blank", "width=800,height=1000");
  if (!w) {
    alert("Bitte Pop-ups für Lagernaut erlauben, damit der Beleg gedruckt werden kann.");
    return;
  }
  w.document.write(belegHtml(d));
  w.document.close();
}
