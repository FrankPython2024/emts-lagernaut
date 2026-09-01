"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { api } from "@/trpc/react";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { ArtikelLabelPreview, ArtikelLabelManager } from "@/components/ui/ArtikelLabel";
import { PageLoader } from "@/components/ui/LoadingSpinner";

export default function ArtikelDetailPage() {
  const params    = useParams<{ id: string }>();
  const artikelId = Number(params?.id);
  const router    = useRouter();
  const { show }  = useToast();
  const { data: session } = useSession();
  const kuerzel   = (session?.user as { kuerzel?: string })?.kuerzel ?? "ADMIN";

  const { data: artikel, isLoading, refetch } = api.lager.getByIdAdmin.useQuery({ id: artikelId });
  const buchungen  = api.buchungen.getByArtikel.useQuery({ artikelId, limit: 20, offset: 0 });
  const kategorien = api.lager.getKategorien.useQuery();
  const alleLPs    = api.lagerplaetze.getAll.useQuery();

  const [form, setForm]               = useState({ bezeichnung: "", kategorie: "", lagerplatz: "", preis: "" });
  const [delOpen, setDelOpen]         = useState(false);
  const [lpModalOpen, setLpModalOpen] = useState(false);
  const [neuerLp,  setNeuerLp]        = useState("");
  const [neuCode,  setNeuCode]        = useState("");
  const [labelOpen, setLabelOpen]     = useState(false);
  const [partnerWahl, setPartnerWahl] = useState("");
  const printFnRef                    = useRef<(() => void) | null>(null);

  // Mögliche Pool-Partner nur laden, solange noch keiner gesetzt ist.
  // Ohne Suchbegriff zeigt der Server die Artikel desselben Geräts.
  const [partnerSuche, setPartnerSuche] = useState("");
  const poolKandidaten = api.lager.poolKandidaten.useQuery(
    { artikelId, suche: partnerSuche.trim() || undefined },
    { enabled: !!artikel && !artikel.poolPartnerId, staleTime: 30_000 },
  );

  const poolVerknuepfen = api.lager.poolVerknuepfen.useMutation({
    onSuccess: (r) => { show(`🔗 Verknüpft: ${r.a} ↔ ${r.b}`, "success"); setPartnerWahl(""); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const poolLoesen = api.lager.poolLoesen.useMutation({
    onSuccess: () => { show("Verknüpfung gelöst", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  useEffect(() => {
    if (artikel) setForm({
      bezeichnung: artikel.bezeichnung,
      kategorie:   artikel.kategorie,
      lagerplatz:  artikel.lagerplatz ?? "",
      // Decimal kommt als String/Zahl an — deutsches Komma für die Eingabe.
      preis:       artikel.preis == null ? "" : String(artikel.preis).replace(".", ","),
    });
  }, [artikel]);

  const update = api.lager.update.useMutation({
    onSuccess: () => { show("✅ Gespeichert", "success"); refetch(); },
    onError:   (e) => show(e.message, "error"),
  });

  const del = api.lager.delete.useMutation({
    onSuccess: () => { show("Artikel gelöscht", "success"); router.push("/admin/artikel"); },
    onError:   (e) => show(e.message, "error"),
  });

  const verschiebe = api.lagerplaetze.verschiebeArtikel.useMutation({
    onSuccess: (r) => {
      show(`✅ Verschoben: ${r.von} → ${r.nach}`, "success");
      setLpModalOpen(false); setNeuerLp(""); setNeuCode("");
      refetch();
    },
    onError: (e) => show(e.message, "error"),
  });

  if (isLoading) return <PageLoader />;
  if (!artikel)  return <div className="text-[#fa3e3e]">Artikel nicht gefunden.</div>;

  const INPUT_CLS = "w-full px-4 py-2.5 rounded-lg border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]";
  const zielLPs   = (alleLPs.data ?? []).filter((l) => l.lagerplatz !== artikel.lagerplatz);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.back()} className="text-[#65676b] hover:text-[#0064d2] text-sm">← Zurück</button>
        <h1 className="text-2xl font-black text-[#1a1a1a] dark:text-[#e4e6eb] flex-1">Artikel #{artikel.id}</h1>
        <div className={`text-3xl font-black ${artikel.bestand > 0 ? "text-[#00a400]" : "text-[#fa3e3e]"}`}>
          Bestand: {artikel.bestand}
        </div>
      </div>

      {/* Edit Form */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm space-y-4">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3">Stammdaten</h2>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Bezeichnung</label>
          <input value={form.bezeichnung} onChange={(e) => setForm((f) => ({ ...f, bezeichnung: e.target.value }))} className={INPUT_CLS} />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Kategorie</label>
          <select value={form.kategorie} onChange={(e) => setForm((f) => ({ ...f, kategorie: e.target.value }))} className={INPUT_CLS}>
            {kategorien.data?.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">Lagerplatz</label>
          <input
            value={form.lagerplatz}
            readOnly
            placeholder="—"
            className={`${INPUT_CLS} cursor-not-allowed opacity-70`}
            title="Wird automatisch aus Modell-Lagerplatz übernommen"
          />
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Automatisch aus Modell-Lagerplatz · Änderung über{" "}
            <a href="/admin/lagerplaetze" className="underline hover:text-[#0064d2]">Lagerplätze</a>
          </p>
        </div>

        {/* Einzelpreis — nötig, wo die Kategorie nichts über den Wert sagt
            (256-GB-SSD vs. 2-TB-NVMe sind beide „Festplatte"). Leer lassen =
            es gilt weiterhin der Kategoriepreis. */}
        <div>
          <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">
            Einzelpreis (€)
          </label>
          <input
            type="text" inputMode="decimal"
            value={form.preis}
            onChange={(e) => setForm({ ...form, preis: e.target.value })}
            placeholder="leer = Kategoriepreis verwenden"
            className={INPUT_CLS}
          />
          <p className="text-xs text-[#65676b] dark:text-[#b0b3b8] mt-1">
            Überschreibt den{" "}
            <a href="/admin/preise" className="underline hover:text-[#0064d2]">Kategoriepreis</a>.
            Sinnvoll bei Festplatten, RAM und allem, wo die Kategorie den Wert nicht trifft.
          </p>
        </div>

        <div className="flex gap-3 pt-2 flex-wrap">
          <button onClick={() => {
            // Deutsches Komma zulassen; leeres Feld = zurück auf Kategoriepreis.
            const roh = form.preis.trim().replace(",", ".");
            const preis = roh === "" ? null : Number(roh);
            if (preis !== null && !Number.isFinite(preis)) { show("Preis ist keine gültige Zahl", "error"); return; }
            update.mutate({
              id: artikelId,
              bezeichnung: form.bezeichnung,
              kategorie:   form.kategorie,
              lagerplatz:  form.lagerplatz || null,
              preis,
            });
          }}
            disabled={update.isPending}
            className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {update.isPending ? "..." : "Speichern"}
          </button>
          <button onClick={() => { setNeuerLp(""); setNeuCode(""); setLpModalOpen(true); }}
            className="px-4 py-2.5 bg-[#f7b928]/10 text-[#f7b928] font-bold rounded-xl hover:bg-[#f7b928]/20 border border-[#f7b928]/30">
            🗄️ Lagerplatz ändern
          </button>
          <button onClick={() => setLabelOpen(true)}
            className="px-4 py-2.5 bg-[#8e44ad]/10 text-[#8e44ad] font-bold rounded-xl hover:bg-[#8e44ad]/20 border border-[#8e44ad]/30">
            🖨️ Label
          </button>
          {artikel.bestand === 0 && (
            <button onClick={() => setDelOpen(true)} className="px-4 py-2.5 bg-[#fa3e3e]/10 text-[#fa3e3e] font-bold rounded-xl hover:bg-[#fa3e3e]/20">
              🗑️ Löschen
            </button>
          )}
        </div>
      </div>

      {/* ── Ersatzteil-Pool ──────────────────────────────────────────────────
          Zwei baugleiche Artikel unter verschiedenen Namen (typisch: Füße vorne
          und hinten) teilen sich einen Bestand. Wer den einen anfragt, bekommt
          das Teil auch dann, wenn es unter dem anderen Namen im Regal liegt. */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3 mb-4">
          🔗 Ersatzteil-Pool
        </h2>

        {artikel.poolPartner ? (
          <div className="space-y-3">
            <p className="text-sm text-[#1a1a1a] dark:text-[#e4e6eb]">
              Verknüpft mit{" "}
              <a href={`/admin/artikel/${artikel.poolPartner.id}`} className="font-bold text-[#0064d2] dark:text-[#45bdff] underline">
                {artikel.poolPartner.bezeichnung}
              </a>
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-[#65676b] dark:text-[#b0b3b8]">
                Hier: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{artikel.bestand}</strong>
              </span>
              <span className="text-[#65676b] dark:text-[#b0b3b8]">
                Partner: <strong className="text-[#1a1a1a] dark:text-[#e4e6eb]">{artikel.poolPartner.bestand}</strong>
              </span>
              <span className="text-[#04B475] font-bold">
                Gemeinsam verfügbar: {artikel.poolBestand}
              </span>
            </div>
            <button
              onClick={() => poolLoesen.mutate({ artikelId })}
              disabled={poolLoesen.isPending}
              className="px-4 py-2.5 bg-[#fa3e3e]/10 text-[#fa3e3e] font-bold rounded-xl hover:bg-[#fa3e3e]/20 border border-[#fa3e3e]/30 disabled:opacity-50"
            >
              {poolLoesen.isPending ? "…" : "Verknüpfung lösen"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
              Nicht verknüpft. Wähle das baugleiche Gegenstück. Beide teilen sich danach einen Bestand.
              Vorgeschlagen werden die Teile <strong>desselben Geräts</strong>; über die Suche findest du alle anderen.
            </p>
            <input
              type="text"
              value={partnerSuche}
              onChange={(e) => setPartnerSuche(e.target.value)}
              placeholder="Suche (z.B. 7411 oder Füße)"
              className="w-full px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
            />
            <div className="flex gap-3 flex-wrap">
              <select
                value={partnerWahl}
                onChange={(e) => setPartnerWahl(e.target.value)}
                className="flex-1 min-w-[240px] px-4 py-2.5 rounded-xl border border-[#ced4da] dark:border-[#3e4042] bg-[#f0f2f5] dark:bg-[#18191a] text-[#1a1a1a] dark:text-[#e4e6eb] outline-none focus:border-[#0064d2]"
              >
                <option value="">Gegenstück wählen</option>
                {(poolKandidaten.data ?? []).map((k) => (
                  <option key={k.id} value={k.id} disabled={!!k.poolPartnerId}>
                    {k.bezeichnung} ({k.bestand} St.){k.poolPartnerId ? " (bereits verknüpft)" : ""}
                  </option>
                ))}
              </select>
              <button
                onClick={() => partnerWahl && poolVerknuepfen.mutate({ artikelId, partnerId: Number(partnerWahl) })}
                disabled={!partnerWahl || poolVerknuepfen.isPending}
                className="px-6 py-2.5 bg-[#0064d2] text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50"
              >
                {poolVerknuepfen.isPending ? "…" : "Verknüpfen"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Buchungshistorie */}
      <div className="bg-white dark:bg-[#242526] rounded-xl border border-[#ced4da] dark:border-[#3e4042] p-6 shadow-sm">
        <h2 className="font-bold text-[#1a1a1a] dark:text-[#e4e6eb] border-b border-[#ced4da] dark:border-[#3e4042] pb-3 mb-4">Buchungshistorie</h2>
        <div className="space-y-2">
          {buchungen.data?.buchungen.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#ced4da] dark:border-[#3e4042] last:border-0 text-sm">
              <span className="text-[#65676b] dark:text-[#b0b3b8] w-24 flex-shrink-0">
                {new Date(b.datum).toLocaleDateString("de-DE")}
              </span>
              <span className="flex-1 font-medium text-[#1a1a1a] dark:text-[#e4e6eb]">{b.mitarbeiter}</span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${b.typ === "EINGANG" ? "bg-green-100 text-green-700" : b.typ === "AUSGANG" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>
                {b.typ}
              </span>
              <span className="font-black w-12 text-right text-right">{b.typ === "EINGANG" ? "+" : b.typ === "AUSGANG" ? "-" : "±"}{b.menge}</span>
              {b.notiz && <span className="text-xs text-[#65676b] dark:text-[#b0b3b8] max-w-[120px] truncate" title={b.notiz}>{b.notiz}</span>}
            </div>
          ))}
          {!buchungen.data?.buchungen.length && <p className="text-[#65676b] dark:text-[#b0b3b8] text-sm text-center py-4">Keine Buchungen</p>}
        </div>
      </div>

      <ConfirmDialog
        open={delOpen} onClose={() => setDelOpen(false)}
        onConfirm={() => del.mutate({ id: artikelId })}
        title="Artikel löschen" danger loading={del.isPending}
        message={<>Artikel <strong>{artikel.bezeichnung}</strong> endgültig löschen?</>}
        confirmText="Löschen"
      />

      {/* Lagerplatz-Verschieben Modal */}
      <Modal open={lpModalOpen} onClose={() => setLpModalOpen(false)} title="Lagerplatz ändern">
        <div className="space-y-4">
          <p className="text-sm text-[#65676b] dark:text-[#b0b3b8]">
            Aktuell:{" "}
            <span className="font-mono font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">
              {artikel.lagerplatz ?? "–"}
            </span>
          </p>

          <div>
            <label className="block text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] mb-1 uppercase">
              Vorhandenen Lagerplatz wählen
            </label>
            <select value={neuerLp} onChange={(e) => { setNeuerLp(e.target.value); setNeuCode(""); }}
              className={INPUT_CLS}>
              <option value="">-- Lagerplatz wählen --</option>
              {zielLPs.map((l) => <option key={l.lagerplatz} value={l.lagerplatz}>{l.lagerplatz}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#65676b] dark:text-[#b0b3b8]">
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
            <span>oder neuen eingeben</span>
            <span className="flex-1 h-px bg-[#ced4da] dark:bg-[#3e4042]" />
          </div>

          <input type="text" placeholder="Neuer Code z.B. HP-2-1-1"
            value={neuCode}
            onChange={(e) => { setNeuCode(e.target.value.toUpperCase()); setNeuerLp(e.target.value.toUpperCase()); }}
            className={`${INPUT_CLS} font-mono`}
          />

          <div className="flex gap-3">
            <button onClick={() => setLpModalOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Abbrechen
            </button>
            <button
              disabled={!neuerLp || verschiebe.isPending}
              onClick={() => verschiebe.mutate({ artikelId, neuerLagerplatz: neuerLp, mitarbeiter: kuerzel })}
              className="flex-1 py-2.5 rounded-xl bg-[#f7b928] text-black font-bold hover:bg-yellow-500 disabled:opacity-50"
            >
              {verschiebe.isPending ? "..." : "Verschieben"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Label via Portal im DOM — wird für Druck gebraucht */}
      {labelOpen && (
        <ArtikelLabelManager
          artikel={{ id: artikel.id, bezeichnung: artikel.bezeichnung, lagerplatz: artikel.lagerplatz, kategorie: artikel.kategorie }}
          onReady={(fn) => { printFnRef.current = fn; }}
        />
      )}

      {/* Label-Druck Modal */}
      <Modal open={labelOpen} onClose={() => setLabelOpen(false)} title="Label drucken (57×32mm)" width="max-w-xl">
        <div className="space-y-5">
          <div>
            <p className="text-xs font-bold text-[#65676b] dark:text-[#b0b3b8] uppercase mb-3">Vorschau (200%):</p>
            <div className="flex justify-center p-4 bg-[#f0f2f5] dark:bg-[#18191a] rounded-xl overflow-auto">
              <ArtikelLabelPreview
                artikel={{ id: artikel.id, bezeichnung: artikel.bezeichnung, lagerplatz: artikel.lagerplatz, kategorie: artikel.kategorie }}
                scale={2}
              />
            </div>
          </div>

          <div className="text-xs text-[#65676b] dark:text-[#b0b3b8] bg-[#f0f2f5] dark:bg-[#18191a] rounded-lg p-3 space-y-1">
            <p>• Format: <strong>57mm × 32mm</strong> · Thermodrucker (Schwarz/Weiß)</p>
            <p>• QR-Code Inhalt: <strong>#{artikel.id}</strong> (Artikel-ID)</p>
            <p>• Druckt direkt auf die Seite, kein Popup-Blocker nötig</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setLabelOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-[#f0f2f5] dark:bg-[#3e4042] text-[#65676b] dark:text-[#b0b3b8] font-semibold">
              Schließen
            </button>
            <button
              onClick={() => printFnRef.current?.()}
              className="flex-1 py-2.5 rounded-xl bg-[#8e44ad] text-white font-bold hover:bg-purple-700"
            >
              🖨️ Drucken
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
