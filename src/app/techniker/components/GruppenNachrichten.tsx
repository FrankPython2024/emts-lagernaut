"use client";
import { useRouter } from "next/navigation";
import { api }       from "@/trpc/react";

interface Props {
  logId:   string;
  kuerzel: string;
}

export default function GruppenNachrichten({ logId, kuerzel }: Props) {
  const router = useRouter();

  const { data = [], refetch } = api.nachrichten.getByLogId.useQuery(
    { kuerzel, logId },
    {
      enabled:         !!(kuerzel && logId && logId !== "unbekannt"),
      refetchInterval: 5_000,
      staleTime:       4_000,
    },
  );

  // Debug — prüfe ob Nachrichten gefunden werden
  if (process.env.NODE_ENV !== "production") {
    console.log("[GruppenNachrichten]", logId, "→", data.length, "Nachrichten");
  }

  const markGelesenMutation = api.nachrichten.markGelesen.useMutation({
    onSuccess: () => refetch(),
  });

  if (!data.length) return null;

  return (
    <div>
      {data.map((r) => {
        // Eingebettetes [LogID: ...] Tag in Vorschau ausblenden
        const logIdTag  = `\n\n[LogID: ${logId}]`;
        const inCleaned = r.nachricht.inhalt.endsWith(logIdTag)
          ? r.nachricht.inhalt.slice(0, -logIdTag.length).trim()
          : r.nachricht.inhalt;

        return (
          <div
            key={r.id}
            style={{
              background:   "rgba(0, 100, 210, 0.08)",
              borderLeft:   "4px solid var(--primary)",
              borderTop:    "2px solid var(--primary)",
              padding:      "12px 16px",
            }}
          >
            {/* Header */}
            <div style={{
              fontWeight:    800,
              fontSize:      "0.85rem",
              color:         "var(--primary)",
              marginBottom:  4,
              display:       "flex",
              alignItems:    "center",
              gap:           6,
            }}>
              <span>📬</span>
              <span>Neue Nachricht vom Admin</span>
            </div>

            {/* Betreff */}
            <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 4 }}>
              {r.nachricht.betreff}
            </div>

            {/* Vorschau */}
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.4 }}>
              {inCleaned.substring(0, 120)}{inCleaned.length > 120 ? "…" : ""}
            </div>

            {/* Button */}
            <button
              onClick={() => {
                markGelesenMutation.mutate({ nachrichtId: r.nachrichtId, kuerzel });
                router.push("/techniker/nachrichten");
              }}
              style={{
                background:   "var(--primary)",
                color:        "white",
                padding:      "6px 14px",
                borderRadius: 20,
                fontSize:     "0.82rem",
                fontWeight:   700,
                fontFamily:   "'Ubuntu', sans-serif",
                border:       "none",
                cursor:       "pointer",
              }}
            >
              📖 Lesen & Antworten
            </button>
          </div>
        );
      })}
    </div>
  );
}
