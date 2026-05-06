// ============================================================
// EMTS LAGERNAUT — code.gs
// Stand: Bereinigt & gefixt (alle 10 Bugs behoben)
// ============================================================
// FIXES DIESER VERSION:
//  [F1] onEdit: alert() entfernt → Fehlerkanal über UserProperties
//  [F2] sidebarBuchung / mobileSchnellBuchung: falscher bucheLager-Parameter
//  [F3] aktualisiereBestandNachHistorie: "Direkt" als Ausgang gezählt
//  [F4] initialerBestandsCheck: "direkt" als Ausgang gezählt
//  [F5] syncBestand: Matching auf Artikel-ID (Spalte A/C), nicht Bezeichnung
//  [F6] syncBestand: "direkt" als Ausgang gezählt
//  [F7] direktBuchen: initialerBestandsCheck() entfernt (zeigte Alert)
//  [F8] letztesEtikettDrucken: nutzt jetzt 'buchungsAbschluss' Property
//  [F9] storniereAnfrageTechniker: name-Parameter wird jetzt genutzt
//  [F10] getLetzteZeileDaten: neuer 'fehler'-Kanal für onEdit-Fehler
//  [F11] onEdit Buchungen: initialerBestandsCheck → aktualisiereBestandNachHistorie
//  [F12] onEdit: techniker korrekt als 4. Parameter an bucheLager übergeben
//  [CLEAN] Doppelte Kommentare entfernt, doGet bereinigt
// ============================================================


function onOpen() {
  SpreadsheetApp.getUi().createMenu('📦 Lagernaut Tools')
      .addItem('Bestände jetzt aktualisieren', 'initialerBestandsCheck')
      .addItem('QR-Etikett drucken', 'etikettDrucken')
      .addItem('🔍 Globale Suche öffnen', 'zeigeSucheSidebar')
      .addItem('➕ Neues Modell anlegen', 'neuesModellAnlegen')
      .addItem('📦 Einzelteil hinzufügen', 'einzelteilAnlegen')
      .addItem('📦 Buchen-Sidebar öffnen', 'zeigeBuchenSidebar')
      .addItem('🏷️ Buchung & Label drucken', 'zeigeBuchungsAbschluss')
      .addItem('🎬 Aktions-Dropdown einrichten (Spalte P)', 'richteAktionsDropdownEin')
      .addSeparator()
      .addItem('⚙️ Trigger installieren (einmalig!)', 'installiereTrigger')
      .addItem('🗑️ Trigger deinstallieren', 'deinstalliereTrigger')
      .addToUi();
}


/**
 * Schreibt einen Live-Status-Schritt in den UserProperties-Kanal.
 * Die BuchenSidebar liest diesen per Poll und zeigt einen visuellen Verarbeitungs-Log.
 * @param {string} msg     - Anzeigetext (z.B. "📦 Buchung wird ausgefuehrt...")
 * @param {number} schritt - Aktueller Schritt (1–4)
 */
function schreibeStatus(msg, schritt) {
  try {
    var props = PropertiesService.getUserProperties();
    props.setProperty('buchungsStatus', JSON.stringify({ msg: msg, schritt: schritt, ts: Date.now() }));
    props.deleteProperty('buchungsStatusGelesen');
  } catch(e) {}
}


/**
 * Haupt-Trigger für Tabellenänderungen.
 * WICHTIG: Simple Trigger — showModalDialog und alert() sind verboten!
 * Fehler werden über UserProperties an die BuchenSidebar (Polling) übergeben.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();
  const col = range.getColumn();
  const row = range.getRow();
  const val = e.value;

  if (row <= 1) return;

  // ── ERSATZTEIL ANFRAGE ────────────────────────────────────────────────────
  if (sheetName === "Ersatzteil Anfrage") {

    // Automatische Kompatibilitätssuche bei Änderung von Gerät oder Teiltyp
    if (col === 4 || col === 5) {
      sucheModellUndBestand(row, sheet);
    }

    // ── 1-Click Buchung (Checkbox Spalte O = 15) ──────────────────────────
    if (col === 15 && (val === "TRUE" || val === true)) {

      const zeilenRange = sheet.getRange(row, 1, 1, sheet.getLastColumn());
      zeilenRange.setBackground("#fff2cc");
      SpreadsheetApp.flush();

      // ── Schritt 1: Artikel-ID ermitteln ─────────────────────────────────
      schreibeStatus("🔍 Artikel-ID wird ermittelt...", 1);
      let gefundeneID = "";
      const wertQ = sheet.getRange(row, 17).getValue(); // Spalte Q

      if (wertQ && !isNaN(wertQ) && String(wertQ).trim() !== "") {
        gefundeneID = wertQ;
      } else if (wertQ && String(wertQ).trim() !== "") {
        const lagerData = SpreadsheetApp.getActiveSpreadsheet()
          .getSheetByName("Lagerbestand").getDataRange().getValues();
        const suchName = String(wertQ).trim().toLowerCase();
        for (let i = 1; i < lagerData.length; i++) {
          if (String(lagerData[i][1]).trim().toLowerCase() === suchName) {
            gefundeneID = lagerData[i][0];
            break;
          }
        }
      }

      if (gefundeneID === "" || isNaN(gefundeneID)) {
        const wertF = sheet.getRange(row, 6).getValue();
        if (wertF && !isNaN(wertF)) gefundeneID = wertF;
      }

      // ── Schritt 2–4: Buchung durchführen ────────────────────────────────
      if (gefundeneID !== "" && !isNaN(gefundeneID)) {
        const techniker     = String(sheet.getRange(row, 2).getValue() || "Unbekannt");
        const statusAnfrage = String(sheet.getRange(row, 12).getValue()).trim();
        const ersatzteil    = String(sheet.getRange(row, 5).getValue() || "Ersatzteil");
        const logId         = String(sheet.getRange(row, 3).getValue() || "");
        const geraet        = String(sheet.getRange(row, 4).getValue() || "");

        const buchungsTyp = (statusAnfrage === "Bedarf") ? "Direkt" : "Ausgang";

        schreibeStatus("📦 Buchung wird ausgeführt (" + buchungsTyp + ")...", 2);
        const erfolg = bucheLager(gefundeneID, -1, buchungsTyp, techniker);

        if (!erfolg.error) {
          schreibeStatus("💾 Bestand wird aktualisiert...", 3);
          zeilenRange.setBackground("#d9ead3");
          sheet.getRange(row, 15).setValue(true);
          sheet.getRange(row, 12).setValue("Abgeschlossen");
          sucheModellUndBestand(row, sheet);

          const infoTeil = getBestand(gefundeneID);
          const lagerort = infoTeil.lagerort || infoTeil.lagerplatz || "–";
          const datumStr = Utilities.formatDate(new Date(), "GMT+1", "dd.MM.yyyy");

          // Schritt 4: Buchungsabschluss → Modal-Trigger für Sidebar
          schreibeStatus("✅ Fertig — Label bereit!", 4);
          const buchungsDaten = JSON.stringify({ techniker, logId, datum: datumStr, ersatzteil, geraet, lagerort });
          PropertiesService.getUserProperties().setProperty("buchungsAbschluss", buchungsDaten);
          PropertiesService.getUserProperties().deleteProperty("buchungsAbschlussGelesen");

        } else {
          zeilenRange.setBackground("#f4cccc");
          sheet.getRange(row, 15).setValue(false);
          schreibeStatus("❌ Buchungsfehler!", 0);
          PropertiesService.getUserProperties().setProperty("buchungsFehler",
            "❌ Buchungsfehler: " + erfolg.error);
          PropertiesService.getUserProperties().deleteProperty("buchungsFehlerGelesen");
        }

      } else {
        zeilenRange.setBackground("#f4cccc");
        sheet.getRange(row, 15).setValue(false);
        schreibeStatus("❌ ID nicht gefunden!", 0);
        PropertiesService.getUserProperties().setProperty("buchungsFehler",
          "❌ ID-Fehler: Keine gültige Artikel-ID für: " + String(sheet.getRange(row, 17).getValue()));
        PropertiesService.getUserProperties().deleteProperty("buchungsFehlerGelesen");
      }
    }

    // Spalte P (16): Wird vom installierbaren Trigger onEditInstallable behandelt.
    // (Simple Trigger darf keine Dialoge öffnen → showModalDialog verboten)
  }

  // ── BUCHUNGEN: Auto-Befüllung ────────────────────────────────────────────
  if (sheetName === "Buchungen") {
    if (col === 3 && val) {
      const info = getBestand(val);
      if (!info.error) {
        const heute = new Date(); heute.setHours(0, 0, 0, 0);
        sheet.getRange(row, 1).setValue(heute).setNumberFormat("dd.mm.yyyy");
        sheet.getRange(row, 4).setValue(info.modell);
        sheet.getRange(row, 5).setValue("Eingang");
        sheet.getRange(row, 6).activate();
      }
    }
    if (col === 6 && val) {
      // [F11] Nur die betroffene ID aktualisieren — kein initialerBestandsCheck (zeigte Alert)
      aktualisiereBestandNachHistorie(sheet.getRange(row, 3).getValue());
    }
  }
}




// ============================================================
// INSTALLIERBARER TRIGGER — Spalte P Aktions-Dropdown
// ============================================================
// Simple Trigger (onEdit) darf keine Dialoge öffnen.
// Dieser installierbare Trigger läuft mit vollen Rechten
// und kann showModalDialog, alert() und alle UI-Methoden aufrufen.
//
// EINMALIG EINRICHTEN: Lagernaut Tools → "⚙️ Trigger installieren"

/**
 * Installierbarer onEdit-Trigger.
 * Verarbeitet das Aktions-Dropdown in Spalte P der "Ersatzteil Anfrage".
 * Muss einmalig über installiereTrigger() registriert werden.
 */
function onEditInstallable(e) {
  if (!e || !e.range) return;
  const sheet     = e.range.getSheet();
  const sheetName = sheet.getName();
  const col       = e.range.getColumn();
  const row       = e.range.getRow();
  const val       = e.value;

  if (sheetName !== "Ersatzteil Anfrage") return;
  if (row <= 1) return;
  if (col !== 16) return;
  if (!val || val === "🎬 Aktion wählen...") return;

  // Dropdown sofort zurücksetzen → wirkt wie ein Button
  sheet.getRange(row, 16).setValue("🎬 Aktion wählen...");
  SpreadsheetApp.flush();

  if (val === "🖨️ Auslagerbeleg drucken") {
    zeigeAuslagerbelgFuerZeile(row, sheet);

  } else if (val === "📋 Details anzeigen") {
    zeigeZeilenDetails(row, sheet);

  } else if (val === "↩️ Anfrage stornieren") {
    const name   = String(sheet.getRange(row, 2).getValue()).trim();
    const repId  = String(sheet.getRange(row, 3).getValue()).trim();
    const teil   = String(sheet.getRange(row, 5).getValue()).trim();
    const status = String(sheet.getRange(row, 12).getValue()).trim();

    if (status !== "Neu") {
      SpreadsheetApp.getUi().alert(
        "ℹ️ Nicht möglich",
        "Nur Anfragen mit Status 'Neu' können storniert werden.\nAktueller Status: " + status,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } else {
      const result = storniereAnfrageTechniker(name, repId, teil);
      SpreadsheetApp.getUi().alert("Lagernaut", result, SpreadsheetApp.getUi().ButtonSet.OK);
    }
  }
}


/**
 * Registriert onEditInstallable als installierbaren Trigger.
 * Verhindert doppelte Registrierung.
 * Einmalig ausführen: Lagernaut Tools → "⚙️ Trigger installieren"
 */
function installiereTrigger() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getUserTriggers(ss);

  // Prüfen ob bereits installiert
  const bereitsVorhanden = triggers.some(t =>
    t.getHandlerFunction() === "onEditInstallable" &&
    t.getEventType()       === ScriptApp.EventType.ON_EDIT
  );

  if (bereitsVorhanden) {
    SpreadsheetApp.getUi().alert(
      "✅ Bereits installiert",
      "Der Trigger 'onEditInstallable' ist bereits aktiv.\nKeine Aktion erforderlich.",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  ScriptApp.newTrigger("onEditInstallable")
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert(
    "✅ Trigger installiert",
    "Das Aktions-Dropdown in Spalte P ist jetzt aktiv.\nAb sofort reagieren die Buttons sofort.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}


/**
 * Entfernt den installierbaren Trigger (für Debugging/Reset).
 */
function deinstalliereTrigger() {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const triggers = ScriptApp.getUserTriggers(ss);
  let geloescht  = 0;

  triggers.forEach(t => {
    if (t.getHandlerFunction() === "onEditInstallable") {
      ScriptApp.deleteTrigger(t);
      geloescht++;
    }
  });

  SpreadsheetApp.getUi().alert(
    "🗑️ Trigger entfernt",
    geloescht + " Trigger gelöscht.",
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

// ============================================================
// KOMPATIBILITÄTS-SUCHE
// ============================================================

/**
 * Sucht in der Kompatibilitäts-Matrix nach Gerät + Teiltyp
 * und trägt Bestand (Spalte N) und Artikel-ID (Spalte Q) in die Anfrage-Zeile ein.
 */
function sucheModellUndBestand(zeile, sheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const matrixSheet = ss.getSheetByName("Kompatibilitaet");
  const matrixData = matrixSheet.getDataRange().getValues();

  let geraetRaw = sheet.getRange(zeile, 4).getValue().toString();
  let geraetAnfrage = geraetRaw.toUpperCase().trim();
  sheet.getRange(zeile, 4).setValue(geraetAnfrage);

  let typAnfrage = sheet.getRange(zeile, 5).getValue().toString().toLowerCase().trim();

  if (geraetAnfrage === "" || typAnfrage === "") return;

  let gefundeneID = "";
  let searchGeraet = geraetAnfrage.toLowerCase();

  for (let i = 1; i < matrixData.length; i++) {
    let mGeraet = matrixData[i][0].toString().toLowerCase().trim();
    let mTyp    = matrixData[i][1].toString().toLowerCase().trim();

    const geraetMatch = mGeraet.includes(searchGeraet) || searchGeraet.includes(mGeraet);
    const typMatch    = mTyp.includes(typAnfrage)    || typAnfrage.includes(mTyp);

    if (geraetMatch && typMatch) {
      gefundeneID = matrixData[i][2]; // Spalte C = Bezeichnung/ID
      break;
    }
  }

  const bestandZelle = sheet.getRange(zeile, 14); // Spalte N
  const idZelle      = sheet.getRange(zeile, 17); // Spalte Q

  if (gefundeneID !== "") {
    idZelle.setValue(gefundeneID);
    const info = getBestand(gefundeneID);
    const bestandZahl = parseInt(info.bestand) || 0;
    const farbe = (bestandZahl <= 0) ? "#d63031" : "#27ae60";
    bestandZelle.setValue("✅ " + info.bestand)
                .setFontColor(farbe)
                .setFontWeight("bold")
                .setHorizontalAlignment("center");
  } else {
    idZelle.setValue("Nicht in Matrix");
    bestandZelle.setValue("❌ N/V").setFontColor("#b2bec3").setHorizontalAlignment("center");
  }
}


// ============================================================
// ARTIKEL ANLEGEN
// ============================================================

/**
 * Legt ein einzelnes Ersatzteil in Lagerbestand + Kompatibilitäts-Matrix an.
 */
function einzelteilAnlegen() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetBestand = ss.getSheetByName("Lagerbestand");
  const sheetKomp    = ss.getSheetByName("Kompatibilitaet");

  if (!sheetBestand || !sheetKomp) {
    ui.alert("Fehler: Blätter nicht gefunden.");
    return;
  }

  const respHersteller = ui.prompt('🚀 Lagernaut Einzelteil', 'Hersteller (z.B. HP):', ui.ButtonSet.OK_CANCEL);
  if (respHersteller.getSelectedButton() !== ui.Button.OK) return;
  const hersteller = respHersteller.getResponseText().trim();

  const respModell = ui.prompt('Modell', 'Modellname (z.B. 840 G5):', ui.ButtonSet.OK_CANCEL);
  if (respModell.getSelectedButton() !== ui.Button.OK) return;
  const modellName = respModell.getResponseText().trim();

  const respTeil = ui.prompt('Bauteil', 'Welches Teil? (z.B. Akku, Display, Netzteil):', ui.ButtonSet.OK_CANCEL);
  if (respTeil.getSelectedButton() !== ui.Button.OK) return;
  const teilName = respTeil.getResponseText().trim();

  const lastRowBestand = sheetBestand.getLastRow();
  let maxId = 0;
  if (lastRowBestand > 1) {
    const idSpalte = sheetBestand.getRange(2, 1, lastRowBestand - 1, 1).getValues();
    maxId = idSpalte.reduce((max, row) => {
      const val = parseInt(row[0]);
      return (!isNaN(val) && val > max) ? val : max;
    }, 0);
  }

  const neueId              = maxId + 1;
  const geraetVoll          = hersteller + " " + modellName;
  const eindeutigeBezeichnung = modellName + " " + teilName;

  sheetBestand.appendRow([neueId, eindeutigeBezeichnung, "OLP", teilName, 0, "", ""]);
  sheetKomp.appendRow([geraetVoll, teilName, eindeutigeBezeichnung]);

  ui.alert("✅ Einzelteil erfolgreich angelegt!\n\n" +
           "ID: " + neueId + "\n" +
           "Bezeichnung: " + eindeutigeBezeichnung + "\n" +
           "Zugeordnet zu: " + geraetVoll);
}


/**
 * Legt ein neues Gerätemodell mit allen Standard-Ersatzteilen
 * in Lagerbestand + Kompatibilitäts-Matrix an (Batch-Write).
 */
function neuesModellAnlegen() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetBestand = ss.getSheetByName("Lagerbestand");
  const sheetKomp    = ss.getSheetByName("Kompatibilitaet");

  if (!sheetBestand || !sheetKomp) {
    ui.alert("Fehler: Eines der Blätter (Lagerbestand oder Kompatibilitaet) wurde nicht gefunden.");
    return;
  }

  const responseModell = ui.prompt('🚀 Lagernaut Modell-Generator', 'Modellname eingeben (z.B. 840 G5):', ui.ButtonSet.OK_CANCEL);
  if (responseModell.getSelectedButton() !== ui.Button.OK) return;
  const modellName = responseModell.getResponseText().trim();

  const responseHersteller = ui.prompt('Hersteller', 'Marke (z.B. Lenovo, HP, Dell):', ui.ButtonSet.OK_CANCEL);
  if (responseHersteller.getSelectedButton() !== ui.Button.OK) return;
  const hersteller = responseHersteller.getResponseText().trim();

  const lastRowBestand = sheetBestand.getLastRow();
  let maxId = 0;
  if (lastRowBestand > 1) {
    const idSpalte = sheetBestand.getRange(2, 1, lastRowBestand - 1, 1).getValues();
    maxId = idSpalte.reduce((max, row) => {
      const val = parseInt(row[0]);
      return (!isNaN(val) && val > max) ? val : max;
    }, 0);
  }

  const teile = [
    "Displaymodul", "Tastatur", "Touchpad", "Füße vorne", "Füße hinten",
    "D Cover", "USB Board", "Power Button", "Lautsprecher", "Lüfter",
    "Thermalmodul", "BIOS Batterie", "Akku"
  ];

  const geraetVoll        = hersteller + " " + modellName;
  const neueBestandZeilen = [];
  const neueKompZeilen    = [];

  teile.forEach((teil, index) => {
    const neueId                = maxId + index + 1;
    const eindeutigeBezeichnung = modellName + " " + teil;
    neueBestandZeilen.push([neueId, eindeutigeBezeichnung, "Lager", teil, 0, "", ""]);
    neueKompZeilen.push([geraetVoll, teil, eindeutigeBezeichnung]);
  });

  sheetBestand.getRange(sheetBestand.getLastRow() + 1, 1, neueBestandZeilen.length, 7).setValues(neueBestandZeilen);
  sheetKomp.getRange(sheetKomp.getLastRow() + 1, 1, neueKompZeilen.length, 3).setValues(neueKompZeilen);

  ui.alert("✅ Mission erfolgreich!\n\n" +
           "Das Modell '" + geraetVoll + "' wurde angelegt.\n" +
           "Vergebene IDs: " + (maxId + 1) + " bis " + (maxId + teile.length));
}


// ============================================================
// BESTAND LESEN
// ============================================================

/**
 * Gibt alle Infos zu einem Artikel zurück (per ID oder Bezeichnung).
 * Lagerbestand: A=ID, B=Bezeichnung, C=Lagerplatz, D=Kategorie, E=Bestand
 */
function getBestand(idOderName) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const lSheet = ss.getSheetByName("Lagerbestand");
  const mSheet = ss.getSheetByName("Kompatibilitaet");

  const lData = lSheet.getDataRange().getValues();
  const mData = mSheet.getDataRange().getValues();

  let res   = { error: true, msg: "Nicht gefunden" };
  const suche = String(idOderName).toLowerCase().trim();

  for (let i = 1; i < lData.length; i++) {
    let rowId    = String(lData[i][0]).toLowerCase().trim();
    let rowModell = String(lData[i][1]).toLowerCase().trim();

    if (rowId === suche || rowModell === suche) {
      const wertAusSpalteC = lData[i][2];

      res = {
        error:     false,
        id:        lData[i][0],
        modell:    lData[i][1],
        lagerort:  wertAusSpalteC, // Alle Aliasse für Kompatibilität mit verschiedenen Aufrufern
        Lagerort:  wertAusSpalteC,
        ort:       wertAusSpalteC,
        lagerplatz: wertAusSpalteC,
        kategorie: lData[i][3],
        bestand:   lData[i][4],
        zeile:     i + 1,
        kompatibel: ""
      };

      try { res.reichweite = lData[i][6] || "∞"; } catch(e) { res.reichweite = "∞"; }

      // Kompatible Geräte aus Matrix ermitteln
      let passendeGeraete = [];
      let meinTeilLow     = String(res.modell).toLowerCase();
      let meineIdLow      = String(res.id).toLowerCase();

      for (let j = 1; j < mData.length; j++) {
        let matrixTeil = String(mData[j][2]).toLowerCase();
        if (matrixTeil === meineIdLow || (matrixTeil.length > 3 && meinTeilLow.includes(matrixTeil))) {
          passendeGeraete.push(mData[j][0]);
        }
      }
      res.kompatibel = passendeGeraete.join(", ");
      break;
    }
  }
  return res;
}


// ============================================================
// BESTAND SCHREIBEN / SYNCHRONISIEREN
// ============================================================

/**
 * Vollständige Neuberechnung aller Bestände aus der Buchungshistorie.
 * Matching über Artikel-ID (Lagerbestand Spalte A ↔ Buchungen Spalte C).
 * Typen: Eingang = +  |  Ausgang = -  |  Direkt = neutral (Bedarf: 1 rein, 1 raus → Netto 0)
 *
 * [F5] Fix: Matching auf Artikel-ID, nicht mehr auf Bezeichnung
 */
function syncBestand() {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const sheetBestand  = ss.getSheetByName("Lagerbestand");
  const sheetBuchungen = ss.getSheetByName("Buchungen");

  if (!sheetBestand || !sheetBuchungen) return;

  const buchungenLastRow = sheetBuchungen.getLastRow();
  if (buchungenLastRow < 2) return;

  const buchungsDaten = sheetBuchungen.getRange(2, 1, buchungenLastRow - 1, 6).getValues();

  // Map aufbauen: Artikel-ID (String) → berechneter Bestand
  const bestandMap = {};

  buchungsDaten.forEach(row => {
    const id    = String(row[2]).trim();                   // Spalte C = Artikel-ID
    const typ   = String(row[4]).trim().toLowerCase();     // Spalte E = Typ
    const menge = parseFloat(row[5]) || 0;                 // Spalte F = Menge

    if (!id || id === "" || menge === 0) return;
    if (!bestandMap[id]) bestandMap[id] = 0;

    if (typ === "eingang") {
      bestandMap[id] += menge;
    } else if (typ === "ausgang") {
      bestandMap[id] -= menge;
    }
    // "direkt" = Bedarf-Buchung (1 rein, 1 raus) → Netto 0, wird nicht auf Bestand angerechnet
  });

  // Lagerbestand aktualisieren — Matching über Artikel-ID (Spalte A)
  const bestandData = sheetBestand.getDataRange().getValues();
  const neueWerte   = [];

  for (let i = 1; i < bestandData.length; i++) {
    const idLager     = String(bestandData[i][0]).trim(); // [F5] Spalte A = ID
    const neuerBestand = bestandMap[idLager] !== undefined ? bestandMap[idLager] : 0;
    neueWerte.push([neuerBestand]);
  }

  if (neueWerte.length > 0) {
    sheetBestand.getRange(2, 5, neueWerte.length, 1).setValues(neueWerte); // Spalte E = Bestand
  }
}


/**
 * Berechnet den Bestand einer einzelnen Artikel-ID neu aus der Buchungshistorie.
 * Schneller als syncBestand(), da nur eine ID verarbeitet wird.
 * Typen: Eingang = +  |  Ausgang = -  |  Direkt = neutral (Bedarf: 1 rein, 1 raus → Netto 0)
 */
function aktualisiereBestandNachHistorie(id) {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const bData  = ss.getSheetByName("Buchungen").getDataRange().getValues();
  const lSheet = ss.getSheetByName("Lagerbestand");
  const lData  = lSheet.getDataRange().getValues();

  let summe  = 0;
  const sID  = String(id).trim();

  for (let i = 1; i < bData.length; i++) {
    if (String(bData[i][2]).trim() === sID) { // Spalte C = Artikel-ID
      const m   = Number(bData[i][5]) || 0;                    // Spalte F = Menge
      const typ = String(bData[i][4]).trim().toLowerCase();     // Spalte E = Typ
      if (typ === "eingang") {
        summe += m;
      } else if (typ === "ausgang") {
        summe -= m;
      }
      // "direkt" = Bedarf-Buchung → Netto 0, kein Einfluss auf Bestand
    }
  }

  for (let j = 1; j < lData.length; j++) {
    if (String(lData[j][0]).trim() === sID) { // Spalte A = ID
      lSheet.getRange(j + 1, 5).setValue(summe); // Spalte E = Bestand
      return summe;
    }
  }
}


/**
 * Vollständige Neuberechnung (manuell über Menü).
 * Liest alle Buchungen und schreibt korrigierte Bestände in Lagerbestand.
 * Typen: Eingang = +  |  Ausgang = -  |  Direkt = neutral (Bedarf: 1 rein, 1 raus → Netto 0)
 */
function initialerBestandsCheck() {
  const ss             = SpreadsheetApp.getActiveSpreadsheet();
  const sheetBestand   = ss.getSheetByName("Lagerbestand");
  const sheetBuchungen = ss.getSheetByName("Buchungen");

  if (!sheetBestand || !sheetBuchungen) {
    SpreadsheetApp.getUi().alert("Fehler: 'Lagerbestand' oder 'Buchungen' nicht gefunden.");
    return;
  }

  const bestandData  = sheetBestand.getDataRange().getValues();
  const buchungenData = sheetBuchungen.getDataRange().getValues();
  if (bestandData.length < 2) return;

  // Map aufbauen: Artikel-ID (String) → berechneter Bestand
  const berechneterBestand = {};
  let buchungsCounter = 0;

  for (let j = 1; j < buchungenData.length; j++) {
    const id     = String(buchungenData[j][2] || "").trim();           // Spalte C = Artikel-ID
    const typRaw = String(buchungenData[j][4] || "").trim().toLowerCase(); // Spalte E = Typ
    const menge  = parseFloat(buchungenData[j][5]) || 0;               // Spalte F = Menge

    if (id === "" || menge === 0) continue;

    const istEingang = typRaw === "eingang";
    const istAusgang = typRaw === "ausgang";
    // "direkt" = Bedarf-Buchung (1 rein, 1 raus) → Netto 0, wird nicht auf Bestand angerechnet

    if (istEingang || istAusgang) {
      if (!berechneterBestand[id]) berechneterBestand[id] = 0;
      berechneterBestand[id] += istEingang ? menge : -menge;
      buchungsCounter++;
    }
  }

  // Lagerbestand schreiben — Matching über Artikel-ID (Spalte A)
  const neueWerte = [];
  for (let i = 1; i < bestandData.length; i++) {
    const idLager      = String(bestandData[i][0]).trim(); // Spalte A = ID
    const finalerBestand = berechneterBestand[idLager] !== undefined ? berechneterBestand[idLager] : 0;
    neueWerte.push([finalerBestand]);
  }

  sheetBestand.getRange(2, 5, neueWerte.length, 1).setValues(neueWerte); // Spalte E = Bestand
  SpreadsheetApp.getUi().alert("✅ Update erfolgreich!\n" + buchungsCounter + " Buchungspositionen verrechnet.");
}


// ============================================================
// BUCHUNGEN
// ============================================================

/**
 * Schreibt eine Buchung in die Buchungen-Tabelle und aktualisiert den Bestand.
 * @param {*}      id   - Artikel-ID
 * @param {number} menge - Menge (negativ für Ausgang; Math.abs wird intern angewendet)
 * @param {string} typ  - "Eingang" | "Ausgang" | "Direkt"
 * @param {string} wer  - Mitarbeiterkürzel oder "System"
 */
function bucheLager(id, menge, typ, wer) {
  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const sheetBuchung = ss.getSheetByName("Buchungen");

    const info       = getBestand(id);
    const bezeichnung = info.modell || "";

    const heute = new Date();
    heute.setHours(0, 0, 0, 0);

    const buchungsArt = typ || (menge > 0 ? "Eingang" : "Ausgang");
    const mitarbeiter = wer || "System";

    // Buchungen: A=Datum, B=Mitarbeiter, C=Artikel-ID, D=Bezeichnung, E=Typ, F=Menge
    const neueZeile = [heute, mitarbeiter, id, bezeichnung, buchungsArt, Math.abs(menge)];

    sheetBuchung.appendRow(neueZeile);
    const lastRow = sheetBuchung.getLastRow();
    sheetBuchung.getRange(lastRow, 1).setNumberFormat('dd.mm.yyyy');
    sheetBuchung.getRange(lastRow, 3).setNumberFormat('0');

    aktualisiereBestandNachHistorie(id);

    return { success: true, bestand: "aktualisiert" };
  } catch (e) {
    return { error: e.message };
  }
}


/**
 * Buchung direkt aus der BuchenSidebar.
 * Prüft Bestand, schreibt Buchung, aktualisiert Bestand.
 * Gibt bei Erfolg ein Buchungs-Objekt zurück → Sidebar zeigt buchungScreen direkt.
 * Gibt bei Fehler einen String zurück (⛔/❌) → Sidebar zeigt Fehlermeldung.
 * Schreibt Fortschritts-Status über schreibeStatus() → Sidebar-Poll zeigt Live-Log.
 */
function direktBuchen(artikelId, bezeichnung, mitarbeiter, menge, typ, datum) {
  try {
    const ss           = SpreadsheetApp.getActiveSpreadsheet();
    const sheetBuchung = ss.getSheetByName("Buchungen");
    if (!sheetBuchung) return "❌ Blatt 'Buchungen' nicht gefunden.";

    // Schritt 1: Bestandsprüfung
    schreibeStatus("🔍 Bestand wird geprüft...", 1);
    if (typ === "Ausgang") {
      const info             = getBestand(artikelId);
      const aktuellerBestand = parseFloat(info.bestand) || 0;
      const gewuenschteMenge = Math.abs(Number(menge)) || 1;
      if (aktuellerBestand <= 0) {
        return "⛔ Kein Bestand! Ausgang nicht möglich (aktuell: " + aktuellerBestand + ").";
      }
      if (gewuenschteMenge > aktuellerBestand) {
        return "⛔ Nicht genug Bestand! Verfügbar: " + aktuellerBestand + ", angefragt: " + gewuenschteMenge + ".";
      }
    }

    // Schritt 2: Buchung schreiben
    schreibeStatus("📝 Buchung wird gespeichert...", 2);
    const d = new Date(datum + "T00:00:00");
    d.setHours(0, 0, 0, 0);

    const neueZeile = [
      d,
      mitarbeiter.trim() || "Unbekannt",
      Number(artikelId),
      bezeichnung,
      typ,
      Math.abs(Number(menge)) || 1
    ];

    sheetBuchung.appendRow(neueZeile);
    const lastRow = sheetBuchung.getLastRow();
    sheetBuchung.getRange(lastRow, 1).setNumberFormat('dd.mm.yyyy');
    sheetBuchung.getRange(lastRow, 3).setNumberFormat('0');

    // Schritt 3: Bestand aktualisieren
    schreibeStatus("💾 Bestand wird aktualisiert...", 3);
    aktualisiereBestandNachHistorie(artikelId);

    // Schritt 4: Abschluss-Daten aufbereiten
    schreibeStatus("✅ Fertig!", 4);
    const info     = getBestand(artikelId);
    const lagerort = info.lagerort || info.lagerplatz || "–";
    const datumStr = Utilities.formatDate(d, "GMT+1", "dd.MM.yyyy");

    const buchungsDaten = {
      techniker:  mitarbeiter.trim() || "Unbekannt",
      logId:      "–",
      datum:      datumStr,
      ersatzteil: bezeichnung,
      geraet:     info.kompatibel
                    ? String(info.kompatibel).split(",")[0].trim()
                    : "–",
      lagerort:   lagerort
    };

    // UserProperties schreiben (beide → Poll erkennt als "schon gelesen" → kein Doppel-Screen)
    const buchungsJson = JSON.stringify(buchungsDaten);
    const props = PropertiesService.getUserProperties();
    props.setProperty("buchungsAbschluss",        buchungsJson);
    props.setProperty("buchungsAbschlussGelesen",  buchungsJson);

    // Buchungs-Objekt zurückgeben → Sidebar zeigt buchungScreen direkt
    return { success: true, buchung: buchungsDaten };

  } catch(e) {
    return "❌ Fehler: " + e.message;
  }
}


/**
 * Buchung direkt aus der Sidebar (Legacy-Fallback).
 * Zeigt nach erfolgreicher Buchung ebenfalls das Abschluss-Modal.
 */
function sidebarBuchung(id) {
  const ui       = SpreadsheetApp.getUi();
  const response = ui.prompt('Lagernaut', 'Wer verbucht dieses Teil?', ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() == ui.Button.OK) {
    const techniker = response.getResponseText().trim() || "Unbekannt";
    const erfolg    = bucheLager(id, -1, "Ausgang", techniker);

    if (!erfolg.error) {
      const info     = getBestand(id);
      const lagerort = info.lagerort || info.lagerplatz || "–";
      const datumStr = Utilities.formatDate(new Date(), "GMT+1", "dd.MM.yyyy");

      const buchungsDaten = JSON.stringify({
        techniker:  techniker,
        logId:      "–",
        datum:      datumStr,
        ersatzteil: info.modell || "–",
        geraet:     info.kompatibel
                      ? String(info.kompatibel).split(",")[0].trim()
                      : "–",
        lagerort:   lagerort
      });

      const props = PropertiesService.getUserProperties();
      props.setProperty("buchungsAbschluss",        buchungsDaten);
      props.setProperty("buchungsAbschlussGelesen",  buchungsDaten);

      zeigeBuchungsAbschluss();

      return { success: true, msg: "✅ Buchung erfolgreich!" };
    } else {
      return { success: false, msg: "❌ Fehler: " + erfolg.error };
    }
  }
  return { success: false, msg: "Abgebrochen." };
}


/**
 * Schnellbuchung aus dem mobilen Portal.
 * [F2] Fix: bucheLager-Aufruf mit korrekter Parameter-Reihenfolge
 */
function mobileSchnellBuchung(id, techniker) {
  const erfolg = bucheLager(id, -1, "Ausgang", techniker); // [F2] korrekte Reihenfolge

  if (!erfolg.error) {
    const info = getBestand(id);
    return {
      success: true,
      msg: "✅ Buchung erfolgreich!\n\nTeil: " + info.modell +
           "\nLagerort: " + (info.lagerort || info.ort) +
           "\nNeuer Bestand: " + info.bestand
    };
  } else {
    return { success: false, msg: "❌ Fehler: " + erfolg.error };
  }
}


// ============================================================
// TECHNIKER-PORTAL FUNKTIONEN
// ============================================================

/**
 * Speichert eine neue Ersatzteil-Anfrage vom Techniker-Portal.
 * kommentar (7. Argument) = Tastatur-Info → Spalte G.
 */
function technikerAnfrageSubmit(id, modell, name, repId, gesuchterBegriff, type, kommentar) {
  try {
    var kb = (typeof kommentar !== "undefined" && kommentar !== null) ? String(kommentar).trim() : "";

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const sheetAnfrage = ss.getSheetByName("Ersatzteil Anfrage");
    const sheetBestand = ss.getSheetByName("Lagerbestand");

    if (!sheetAnfrage) return "❌ Fehler: Blatt 'Ersatzteil Anfrage' fehlt!";
    if (!sheetBestand) return "❌ Fehler: Blatt 'Lagerbestand' fehlt!";

    const info            = getBestand(id);
    let initialerStatus   = "Neu";
    let bestandBeiKlick   = parseFloat(info.bestand) || 0;

    if (type !== 'bedarf') {
      initialerStatus = (bestandBeiKlick > 0) ? "Neu" : "Bedarf";
      if (bestandBeiKlick <= 0) bestandBeiKlick = 0;
    } else {
      initialerStatus = "Bedarf";
      bestandBeiKlick = 0;
    }

    let geraeteBezeichnung = (gesuchterBegriff || "Universal").toUpperCase().trim();
    const spalteG          = (kb !== "") ? kb : bestandBeiKlick; // Tastatur-Info ODER Bestand-Snapshot

    const neueZeile = [
      new Date(),          // A: Datum
      name,                // B: Techniker
      repId,               // C: LogID
      geraeteBezeichnung,  // D: Gerät
      info.kategorie,      // E: Teil
      1,                   // F: Menge
      spalteG,             // G: Tastatur-Info oder Bestand-Snapshot
      "", "", "", "",      // H–K: leer
      initialerStatus      // L: Status
    ];

    sheetAnfrage.appendRow(neueZeile);
    const lastRow = sheetAnfrage.getLastRow();

    if (typeof sucheModellUndBestand === "function") {
      sucheModellUndBestand(lastRow, sheetAnfrage);
    }

    // Bestand für diese ID neu berechnen
    aktualisiereBestandNachHistorie(id);

    return (initialerStatus === "Bedarf")
      ? "🔔 Bedarf wurde gemeldet."
      : "✅ Anfrage erfolgreich! 1 Stück wurde reserviert.";

  } catch (e) {
    return "❌ Systemfehler: " + e.message;
  }
}


/**
 * Holt die Anfragen eines Technikers mit Pagination.
 * @param {string} name   - Techniker-Kürzel
 * @param {number} offset - Anzahl zu überspringender Einträge
 */
function getAnfragenFuerTechniker(name, offset = 0) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ersatzteil Anfrage");
  const data  = sheet.getDataRange().getValues();

  const meineAnfragen = [];
  const suchName      = String(name).toLowerCase().trim();
  const limit         = 20;
  let matchesFound    = 0;
  let hasMore         = false;

  for (let i = data.length - 1; i > 0; i--) {
    const zeilenName = String(data[i][1]).toLowerCase().trim();

    if (zeilenName === suchName) {
      matchesFound++;
      if (matchesFound > offset) {
        if (meineAnfragen.length < limit) {
          meineAnfragen.push({
            datum:  Utilities.formatDate(new Date(data[i][0]), "GMT+1", "dd.MM. HH:mm"),
            repId:  data[i][2],
            geraet: data[i][3],
            teil:   data[i][4],
            status: data[i][11] || "Neu"
          });
        } else {
          hasMore = true;
          break;
        }
      }
    }
  }
  return { anfragen: meineAnfragen, hasMore: hasMore, offset: offset };
}


/**
 * Storniert eine offene Anfrage (Status "Neu").
 * Matching über Techniker-Name, RepID und Teilname.
 *
 * [F9] Fix: name-Parameter wird jetzt als zusätzliches Suchkriterium genutzt
 */
function storniereAnfrageTechniker(name, repId, teilName) {
  try {
    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const sheetAnfrage = ss.getSheetByName("Ersatzteil Anfrage");
    if (!sheetAnfrage) return "❌ Fehler: Blatt nicht gefunden.";

    const fullData   = sheetAnfrage.getDataRange().getValues();
    const suchRepId  = String(repId).trim();
    const suchTeil   = String(teilName).trim().toLowerCase();
    const suchName   = String(name).trim().toLowerCase(); // [F9] Name wird jetzt genutzt

    for (let i = fullData.length - 1; i >= 1; i--) {
      let rId      = String(fullData[i][2]).trim();               // Spalte C: LogID
      let artikel  = String(fullData[i][4]).trim().toLowerCase(); // Spalte E: Teil
      let status   = String(fullData[i][11]).trim();              // Spalte L: Status
      let techName = String(fullData[i][1]).trim().toLowerCase(); // Spalte B: Techniker

      // [F9] Alle vier Kriterien müssen passen
      if (rId === suchRepId && artikel === suchTeil && status === "Neu" && techName === suchName) {
        sheetAnfrage.getRange(i + 1, 12).setValue("Storniert"); // Spalte L

        // Bestand für die betroffene Artikel-ID neu berechnen
        const artikelId = fullData[i][16]; // Spalte Q: Artikel-ID
        if (artikelId) aktualisiereBestandNachHistorie(artikelId);

        return "✅ Storniert & Bestand automatisch korrigiert.";
      }
    }
    return "❌ Keine offene Anfrage gefunden.";
  } catch (e) {
    return "❌ Fehler: " + e.message;
  }
}



// ============================================================
// AKTIONS-DROPDOWN SPALTE P — HELPER-FUNKTIONEN
// ============================================================

/**
 * Richtet das Aktions-Dropdown in allen Zeilen von Spalte P ein.
 * Einmalig ausführen (oder über Menü aufrufbar machen).
 * Optionen: Auslagerbeleg drucken | Details anzeigen | Stornieren
 */
function richteAktionsDropdownEin() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ersatzteil Anfrage");
  if (!sheet) { SpreadsheetApp.getUi().alert("Blatt nicht gefunden."); return; }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  // Dropdown-Validierung für Spalte P (16), ab Zeile 2
  const range = sheet.getRange(2, 16, lastRow - 1, 1);
  const rule  = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      "🎬 Aktion wählen...",
      "🖨️ Auslagerbeleg drucken",
      "📋 Details anzeigen",
      "↩️ Anfrage stornieren"
    ], true)
    .setAllowInvalid(false)
    .build();

  range.setDataValidation(rule);

  // Alle leeren Zellen mit Platzhalter füllen
  const werte = range.getValues();
  const neueWerte = werte.map(r => [r[0] && r[0] !== "" ? r[0] : "🎬 Aktion wählen..."]);
  range.setValues(neueWerte);

  // Spaltenbreite anpassen
  sheet.setColumnWidth(16, 185);

  SpreadsheetApp.getUi().alert("✅ Aktions-Dropdown in Spalte P eingerichtet!\n" + (lastRow - 1) + " Zeilen konfiguriert.");
}


/**
 * Öffnet ein Modal mit dem Auslager-Beleg für eine bestimmte Zeile.
 * Wird aus dem Spalte-P Dropdown aufgerufen.
 * Zeigt dieselbe Ansicht wie nach einer Checkbox-Buchung.
 */
function zeigeAuslagerbelgFuerZeile(row, sheet) {
  const techniker  = String(sheet.getRange(row, 2).getValue()  || "–");
  const logId      = String(sheet.getRange(row, 3).getValue()  || "–");
  const geraet     = String(sheet.getRange(row, 4).getValue()  || "–");
  const ersatzteil = String(sheet.getRange(row, 5).getValue()  || "–");
  const status     = String(sheet.getRange(row, 12).getValue() || "–");
  const lagerortRaw = sheet.getRange(row, 17).getValue(); // Spalte Q = Artikel-ID
  const datumRaw   = sheet.getRange(row, 1).getValue();

  // Lagerort über Artikel-ID ermitteln
  let lagerort = "–";
  if (lagerortRaw && !isNaN(lagerortRaw)) {
    const info = getBestand(lagerortRaw);
    if (!info.error) lagerort = info.lagerort || info.lagerplatz || "–";
  }

  const datum = datumRaw
    ? Utilities.formatDate(new Date(datumRaw), "GMT+1", "dd.MM.yyyy")
    : "–";

  // Status-Farbe
  const statusFarbe = status === "Abgeschlossen" ? "#00a400"
                    : status === "Bedarf"         ? "#e67e22"
                    : status === "Storniert"      ? "#e74c3c"
                    : "#0064d2";

  const html = '<!DOCTYPE html><html><head><base target="_top"><meta charset="UTF-8">'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Inter,sans-serif;background:#f0f2f5}'
    + '.top{background:linear-gradient(135deg,#0064d2,#0095ff);color:white;padding:16px 18px 12px}'
    + '.top h2{font-size:15px;font-weight:900;margin-bottom:3px}'
    + '.top p{font-size:10px;opacity:.8}'
    + '.body{background:white;padding:14px 18px}'
    + '.row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f2f5}'
    + '.row:last-child{border-bottom:none}'
    + '.rl{font-size:10px;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.4px}'
    + '.rv{font-size:13px;font-weight:700;color:#1a1a1a;text-align:right;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.rv.blue{color:#0064d2}'
    + '.badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;color:white;background:' + statusFarbe + '}'
    + '.lbl{width:57mm;height:32mm;background:white;border:1.5px solid #333;border-radius:1mm;box-sizing:border-box;overflow:hidden;display:none;flex-direction:row;margin:0 auto;font-family:Arial,Helvetica,sans-serif}'
    + '.lbl-stripe{width:8mm;background:#000;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.lbl-stripe-t{color:white;font-size:9.5px;font-weight:900;letter-spacing:3.5px;text-transform:uppercase;writing-mode:vertical-rl;transform:rotate(180deg)}'
    + '.lbl-main{flex:1;display:flex;flex-direction:column;overflow:hidden}'
    + '.lbl-head{padding:1.2mm 2.5mm 0.8mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-bottom:0.3mm solid #ddd}'
    + '.lbl-head-t{font-size:5.5px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.8px}'
    + '.lbl-head-d{font-size:7.5px;font-family:monospace;color:#333;font-weight:700}'
    + '.lbl-mid{flex:1;display:flex;align-items:center;justify-content:center;padding:0 2mm}'
    + '.lbl-id{font-size:21px;font-weight:900;color:#000;font-family:monospace;letter-spacing:2px;line-height:1}'
    + '.lbl-foot{padding:1mm 2.5mm 1.2mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-top:0.3mm solid #ddd}'
    + '.lbl-tech{font-size:10px;font-weight:900;color:#000}'
    + '.lbl-teil{font-size:11px;font-weight:800;color:#000;max-width:31mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}'
    + '.footer{padding:10px 18px;background:#f8f9fa;border-top:1px solid #e8eaed;display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.btn{padding:10px;border-radius:9px;border:none;font-family:Inter,sans-serif;font-size:13px;font-weight:700;cursor:pointer;width:100%}'
    + '.btn-print{background:#00a400;color:white}'
    + '.btn-close{background:#0064d2;color:white}'
    + '@media print{'
    + '@page{size:57mm 32mm;margin:0}'
    + '.top,.body,.footer{display:none!important}'
    + '.lbl{display:flex!important;border:none!important;border-radius:0!important;width:57mm!important;height:32mm!important}'
    + '}'
    + '</style></head><body>'
    + '<div class="top"><h2>🖨️ Auslager-Beleg</h2><p>Zeile ' + row + ' · ' + geraet + '</p></div>'
    + '<div class="body">'
    + '<div class="row"><span class="rl">Ersatzteil</span><span class="rv blue">' + ersatzteil + '</span></div>'
    + '<div class="row"><span class="rl">Gerät</span><span class="rv">' + geraet + '</span></div>'
    + '<div class="row"><span class="rl">Log-ID</span><span class="rv">' + logId + '</span></div>'
    + '<div class="row"><span class="rl">Techniker</span><span class="rv">' + techniker + '</span></div>'
    + '<div class="row"><span class="rl">Lagerort</span><span class="rv">' + lagerort + '</span></div>'
    + '<div class="row"><span class="rl">Datum</span><span class="rv">' + datum + '</span></div>'
    + '<div class="row"><span class="rl">Status</span><span class="badge">' + status + '</span></div>'
    + '</div>'
    // Druck-Label (nur beim Drucken sichtbar)
    + '<div class="lbl">'
    + '<div class="lbl-stripe"><span class="lbl-stripe-t">EMTS</span></div>'
    + '<div class="lbl-main">'
    + '<div class="lbl-head">'
    + '<span class="lbl-head-t">Auslager-Beleg</span>'
    + '<span class="lbl-head-d">' + datum + '</span>'
    + '</div>'
    + '<div class="lbl-mid">'
    + '<span class="lbl-id">' + String(logId).replace(/\B(?=(\d{3})+(?!\d))/g,'.') + '</span>'
    + '</div>'
    + '<div class="lbl-foot">'
    + '<span class="lbl-tech">' + techniker + '</span>'
    + '<span class="lbl-teil">' + ersatzteil + '</span>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="footer">'
    + '<button class="btn btn-print" onclick="window.print()">🖨️ Label drucken</button>'
    + '<button class="btn btn-close" onclick="google.script.host.close()">✓ Schließen</button>'
    + '</div>'
    + '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(390),
    'Auslager-Beleg · Zeile ' + row
  );
}


/**
 * Zeigt alle Details einer Anfrage-Zeile als kompaktes Modal.
 * Wird aus dem Spalte-P Dropdown aufgerufen.
 */
function zeigeZeilenDetails(row, sheet) {
  const zeitstempel = sheet.getRange(row, 1).getValue();
  const datum       = zeitstempel
    ? Utilities.formatDate(new Date(zeitstempel), "GMT+1", "dd.MM.yyyy HH:mm")
    : "–";

  const techniker  = String(sheet.getRange(row, 2).getValue()  || "–");
  const logId      = String(sheet.getRange(row, 3).getValue()  || "–");
  const geraet     = String(sheet.getRange(row, 4).getValue()  || "–");
  const ersatzteil = String(sheet.getRange(row, 5).getValue()  || "–");
  const menge      = String(sheet.getRange(row, 6).getValue()  || "1");
  const kommentar  = String(sheet.getRange(row, 7).getValue()  || "–");
  const status     = String(sheet.getRange(row, 12).getValue() || "–");
  const bestand    = String(sheet.getRange(row, 14).getValue() || "–");
  const artikelId  = String(sheet.getRange(row, 17).getValue() || "–");

  const statusFarbe = status === "Abgeschlossen" ? "#00a400"
                    : status === "Bedarf"         ? "#e67e22"
                    : status === "Storniert"      ? "#e74c3c"
                    : "#0064d2";

  const html = '<!DOCTYPE html><html><head><base target="_top"><meta charset="UTF-8">'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Inter,sans-serif;background:#f0f2f5}'
    + '.top{background:linear-gradient(135deg,#333,#555);color:white;padding:14px 18px 10px}'
    + '.top h2{font-size:14px;font-weight:900;margin-bottom:2px}'
    + '.top p{font-size:10px;opacity:.7}'
    + '.body{background:white;padding:12px 18px}'
    + '.row{display:flex;justify-content:space-between;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f0f2f5}'
    + '.row:last-child{border-bottom:none}'
    + '.rl{font-size:10px;color:#aaa;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding-top:1px;flex-shrink:0}'
    + '.rv{font-size:12px;font-weight:700;color:#1a1a1a;text-align:right;max-width:62%;word-break:break-word}'
    + '.rv.blue{color:#0064d2}'
    + '.rv.mono{font-family:monospace;font-size:13px}'
    + '.badge{font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;color:white;background:' + statusFarbe + '}'
    + '.footer{padding:10px 18px;background:#f8f9fa;border-top:1px solid #e8eaed;}'
    + '.btn{width:100%;padding:10px;border-radius:9px;border:none;font-family:Inter,sans-serif;font-size:13px;font-weight:700;cursor:pointer;background:#0064d2;color:white}'
    + '</style></head><body>'
    + '<div class="top"><h2>📋 Anfrage-Details</h2><p>Zeile ' + row + ' · ' + datum + '</p></div>'
    + '<div class="body">'
    + '<div class="row"><span class="rl">Log-ID</span><span class="rv mono blue">' + logId + '</span></div>'
    + '<div class="row"><span class="rl">Techniker</span><span class="rv">' + techniker + '</span></div>'
    + '<div class="row"><span class="rl">Gerät</span><span class="rv">' + geraet + '</span></div>'
    + '<div class="row"><span class="rl">Ersatzteil</span><span class="rv blue">' + ersatzteil + '</span></div>'
    + '<div class="row"><span class="rl">Menge</span><span class="rv">' + menge + '</span></div>'
    + '<div class="row"><span class="rl">Artikel-ID</span><span class="rv mono">' + artikelId + '</span></div>'
    + '<div class="row"><span class="rl">Bestandscheck</span><span class="rv">' + bestand + '</span></div>'
    + '<div class="row"><span class="rl">Kommentar</span><span class="rv">' + kommentar + '</span></div>'
    + '<div class="row"><span class="rl">Status</span><span class="badge">' + status + '</span></div>'
    + '</div>'
    + '<div class="footer"><button class="btn" onclick="google.script.host.close()">✓ Schließen</button></div>'
    + '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(370).setHeight(400),
    'Details · Zeile ' + row
  );
}

// ============================================================
// SUCHE
// ============================================================

/**
 * Globale Suche über Lagerbestand + Kompatibilitäts-Matrix.
 * Gibt direkte Treffer (ID/Bezeichnung/Ort) und Kompatibilitäts-Treffer zurück.
 */
function sucheGlobal(query) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const lagerSheet  = ss.getSheetByName("Lagerbestand");
  const matrixSheet = ss.getSheetByName("Kompatibilitaet");

  const lData    = lagerSheet.getDataRange().getValues();
  const mData    = matrixSheet.getDataRange().getValues();
  const results  = [];
  const q        = query.toLowerCase().trim();
  const qWords   = q.split(" ").filter(w => w.length > 1);
  const gefundeneIDs = new Set();

  // Matrix: Teil → Geräte-Map aufbauen
  const teilZuGeraetenMap = {};
  for (let i = 1; i < mData.length; i++) {
    let geraet = String(mData[i][0]).trim();
    let teil   = String(mData[i][2]).trim().toLowerCase();
    if (geraet && teil) {
      if (!teilZuGeraetenMap[teil]) teilZuGeraetenMap[teil] = [];
      teilZuGeraetenMap[teil].push(geraet);
    }
  }

  // Kompatible Modell-Bezeichnungen aus Matrix sammeln
  const kompatibleModellNamen = [];
  for (let i = 1; i < mData.length; i++) {
    let matrixGeraet = String(mData[i][0]).toLowerCase();
    let match = qWords.length > 0
      ? qWords.every(w => matrixGeraet.includes(w))
      : matrixGeraet.includes(q);
    if (match) {
      kompatibleModellNamen.push(String(mData[i][2]).toLowerCase());
    }
  }

  // Lagerbestand durchsuchen
  for (let i = 1; i < lData.length; i++) {
    const id        = String(lData[i][0]);
    const modell    = String(lData[i][1]);
    const ort       = String(lData[i][2]);
    const kategorie = String(lData[i][3]);
    const bestand   = Number(lData[i][4]);

    const idLow    = id.toLowerCase();
    const modellLow = modell.toLowerCase();

    const istDirekt = qWords.length > 0
      ? qWords.every(w => modellLow.includes(w) || idLow.includes(w) || ort.toLowerCase().includes(w))
      : (modellLow.includes(q) || idLow.includes(q));

    const istKomp = kompatibleModellNamen.some(m => modellLow.includes(m) || idLow === m);

    if (istDirekt || istKomp) {
      if (!gefundeneIDs.has(id)) {
        gefundeneIDs.add(id);

        let cross     = (teilZuGeraetenMap[modellLow] || teilZuGeraetenMap[idLow] || []);
        const bereinigt = cross.filter(g => !modellLow.includes(g.toLowerCase())).slice(0, 5);

        results.push({
          id, modell, ort, kategorie, bestand,
          zeile:       i + 1,
          typ:         istKomp && !istDirekt ? "🔗 Passend" : "📦 Bestand",
          crossModels: bereinigt
        });
      }
    }
  }
  return results;
}


/**
 * Gibt alle Geräte aus der Matrix zurück, die dieselbe Ersatzteil-Bezeichnung nutzen.
 * Sucht in Spalte C der Kompatibilitäts-Matrix.
 */
function getKompatibleGeraete(modellName) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Kompatibilitaet");
    if (!sheet) return ["Fehler: Blatt fehlt"];

    const data       = sheet.getDataRange().getValues();
    const ergebnis   = [];
    const suchBegriff = String(modellName).split('(')[0].trim().toLowerCase();

    for (let i = 1; i < data.length; i++) {
      let matrixModell = String(data[i][2]).trim().toLowerCase();
      let geraet       = String(data[i][0]).trim();
      if (matrixModell === suchBegriff && geraet !== "") {
        ergebnis.push(geraet);
      }
    }
    return [...new Set(ergebnis)].sort();

  } catch (e) {
    return ["Systemfehler: " + e.message];
  }
}


/**
 * Zeigt kompatible Geräte für die aktuell ausgewählte Zelle als Alert.
 */
function zeigeKompatibleGeraete() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const ausgewaehlterWert = sheet.getActiveCell().getValue();

  if (!ausgewaehlterWert) {
    ui.alert("Bitte wähle zuerst eine Zelle mit einem Ersatzteil aus!");
    return;
  }
  const ergebnisText = getKompatibleGeraete(ausgewaehlterWert);
  ui.alert("Kompatible Geräte für: " + ausgewaehlterWert, ergebnisText, ui.ButtonSet.OK);
}


// ============================================================
// SIDEBAR & UI
// ============================================================

function zeigeBuchenSidebar() {
  const html = HtmlService.createTemplateFromFile('BuchenSidebar')
    .evaluate()
    .setTitle('📦 Direkt verbuchen');
  SpreadsheetApp.getUi().showSidebar(html);
}

function zeigeSucheSidebar() {
  const html = HtmlService.createTemplateFromFile('SearchSidebar').evaluate()
      .setTitle('Lagernaut Globale Suche')
      .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function springeZuZeile(zeile) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Lagerbestand");
  sheet.activate();
  sheet.getRange(zeile, 1).activate();
}


/**
 * Polling-Funktion für die BuchenSidebar (alle 80ms).
 *
 * Gibt zurück:
 *   { typ: 'buchung', ... }              — Buchung abgeschlossen → Sidebar ruft zeigeBuchungsAbschluss()
 *   { typ: 'fehler',  msg }              — Buchungsfehler aus onEdit
 *   { typ: 'status',  msg, schritt, gesamt } — Live-Log während Verarbeitung
 *   { typ: 'zeile',   ... }              — aktive Zeile in Lagerbestand
 *   null                                 — nichts zu tun
 */
function getLetzteZeileDaten() {
  try {
    var props = PropertiesService.getUserProperties();

    // Kanal 1: Abgeschlossene Buchung aus onEdit (Checkbox-Workflow)
    var buchung       = props.getProperty('buchungsAbschluss');
    var buchungGelesen = props.getProperty('buchungsAbschlussGelesen');
    if (buchung && buchung !== buchungGelesen) {
      props.setProperty('buchungsAbschlussGelesen', buchung);
      var b = JSON.parse(buchung);
      return {
        typ:        'buchung',
        techniker:  b.techniker  || '',
        logId:      b.logId      || '',
        datum:      b.datum      || '',
        ersatzteil: b.ersatzteil || '',
        geraet:     b.geraet     || '',
        lagerort:   b.lagerort   || '–'
      };
    }

    // Kanal 2: Fehler aus onEdit (ersetzt verbotenes alert() im Simple Trigger) [F10]
    var fehler       = props.getProperty('buchungsFehler');
    var fehlerGelesen = props.getProperty('buchungsFehlerGelesen');
    if (fehler && fehler !== fehlerGelesen) {
      props.setProperty('buchungsFehlerGelesen', fehler);
      return { typ: 'fehler', msg: fehler };
    }

    // Kanal 3: Live-Status während Verarbeitung (schreibeStatus() aus onEdit)
    // Sidebar zeigt Fortschrittsbalken / Log-Einträge während der Buchung läuft
    var status       = props.getProperty('buchungsStatus');
    var statusGelesen = props.getProperty('buchungsStatusGelesen');
    if (status && status !== statusGelesen) {
      props.setProperty('buchungsStatusGelesen', status);
      try {
        var s = JSON.parse(status);
        return { typ: 'status', msg: s.msg, schritt: s.schritt, gesamt: 4 };
      } catch(ex) {}
    }

    // Kanal 4: Normale Zeilen-Abfrage im Lagerbestand-Sheet
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getName() !== "Lagerbestand") return null;

    const row = sheet.getActiveRange().getRow();
    if (row <= 1) return null;

    const artikelId = sheet.getRange(row, 1).getValue();
    if (!artikelId) return null;

    return {
      typ:         'zeile',
      artikelId:   String(artikelId),
      bezeichnung: String(sheet.getRange(row, 2).getValue()),
      lagerplatz:  String(sheet.getRange(row, 3).getValue()),
      bestand:     String(sheet.getRange(row, 5).getValue()),
      row:         row
    };
  } catch(e) {
    return null;
  }
}


// ============================================================
// ETIKETTEN & DRUCK
// ============================================================

function etikettDrucken() {
  const html = HtmlService.createTemplateFromFile('PrintTemplate').evaluate().setWidth(520).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Lagernaut Multi-Drucker');
}

function etikettDruckenMitId(artikelId) {
  const tmpl = HtmlService.createTemplateFromFile('PrintTemplate');
  tmpl.vorausgewaehltId = String(artikelId);
  const html = tmpl.evaluate().setWidth(520).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Lagernaut QR-Drucker');
}

function getLagerDatenFuerDruck() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const data = ss.getSheetByName("Lagerbestand").getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      result.push({
        id:         String(data[i][0]),
        modell:     String(data[i][1]),
        typ:        String(data[i][3]),
        bestand:    Number(data[i][4]),
        lagerplatz: String(data[i][2])
      });
    }
  }
  return result;
}


/**
 * Zeigt das Buchungs-Abschluss-Modal nach einer Checkbox-Buchung.
 * Enthält alle Buchungsinfos + Label-Druck-Button (57mm × 32mm).
 */
function zeigeBuchungsAbschluss() {
  var raw = PropertiesService.getUserProperties().getProperty('buchungsAbschluss');
  if (!raw) { SpreadsheetApp.getUi().alert('Keine aktuelle Buchung gefunden.'); return; }

  var _d = JSON.parse(raw);
  var t  = String(_d.techniker  || '');
  var l  = String(_d.logId      || '');
  var d  = String(_d.datum      || '');
  var e  = String(_d.ersatzteil || '');
  var g  = String(_d.geraet     || '');
  var o  = String(_d.lagerort   || '–');

  var html = '<!DOCTYPE html><html><head><base target="_top"><meta charset="UTF-8">'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Inter,sans-serif;background:#f0f2f5;padding:0}'
    + '.top{background:linear-gradient(135deg,#0064d2,#0095ff);color:white;padding:18px 20px 14px}'
    + '.top h2{font-size:16px;font-weight:900;margin-bottom:4px}'
    + '.top p{font-size:11px;opacity:0.85}'
    + '.body{background:white;padding:16px 20px}'
    + '.row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f2f5}'
    + '.row:last-child{border-bottom:none}'
    + '.rl{font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.4px}'
    + '.rv{font-size:13px;font-weight:700;color:#1a1a1a;text-align:right;max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.rv.blue{color:#0064d2}'
    + '.lbl{width:57mm;height:32mm;background:white;border:1.5px solid #333;border-radius:1mm;box-sizing:border-box;overflow:hidden;display:none;flex-direction:row;margin:0 auto;font-family:Arial,Helvetica,sans-serif}'
    + '.lbl-stripe{width:8mm;background:#000;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.lbl-stripe-t{color:white;font-size:9.5px;font-weight:900;letter-spacing:3.5px;text-transform:uppercase;writing-mode:vertical-rl;transform:rotate(180deg)}'
    + '.lbl-main{flex:1;display:flex;flex-direction:column;overflow:hidden}'
    + '.lbl-head{padding:1.2mm 2.5mm 0.8mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-bottom:0.3mm solid #ddd}'
    + '.lbl-head-t{font-size:5.5px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.8px}'
    + '.lbl-head-d{font-size:7.5px;font-family:monospace;color:#333;font-weight:700}'
    + '.lbl-mid{flex:1;display:flex;align-items:center;justify-content:center;padding:0 2mm}'
    + '.lbl-id{font-size:21px;font-weight:900;color:#000;font-family:monospace;letter-spacing:2px;line-height:1}'
    + '.lbl-foot{padding:1mm 2.5mm 1.2mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-top:0.3mm solid #ddd}'
    + '.lbl-tech{font-size:10px;font-weight:900;color:#000}'
    + '.lbl-teil{font-size:11px;font-weight:800;color:#000;max-width:31mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}'
    + '.footer{padding:12px 20px;background:#f8f9fa;border-top:1px solid #e8eaed;display:grid;grid-template-columns:1fr 1fr;gap:10px}'
    + '.btn{padding:11px;border-radius:10px;border:none;font-family:Inter,sans-serif;font-size:13px;font-weight:700;cursor:pointer;width:100%;transition:all 0.1s}'
    + '.btn-ok{background:#0064d2;color:white}.btn-ok:hover{background:#0055b5}'
    + '.btn-print{background:#00a400;color:white}.btn-print:hover{background:#008800}'
    + '@media print{'
    + '@page{size:57mm 32mm;margin:0}'
    + '.top,.body,.footer{display:none!important}'
    + '.lbl{display:flex!important;border:none!important;border-radius:0!important;width:57mm!important;height:32mm!important}'
    + '}'
    + '</style></head><body>'
    + '<div class="top"><h2>✅ Buchung abgeschlossen</h2><p>Das Teil wurde erfolgreich ausgebucht</p></div>'
    + '<div class="body">'
    + '<div class="row"><span class="rl">Ersatzteil</span><span class="rv blue">' + e + '</span></div>'
    + '<div class="row"><span class="rl">Gerät</span><span class="rv">' + g + '</span></div>'
    + '<div class="row"><span class="rl">Log-ID</span><span class="rv">' + l + '</span></div>'
    + '<div class="row"><span class="rl">Für Techniker</span><span class="rv">' + t + '</span></div>'
    + '<div class="row"><span class="rl">Lagerort</span><span class="rv">' + o + '</span></div>'
    + '<div class="row"><span class="rl">Datum</span><span class="rv">' + d + '</span></div>'
    + '</div>'
    + '<div class="lbl">'
    + '<div class="lbl-stripe"><span class="lbl-stripe-t">EMTS</span></div>'
    + '<div class="lbl-main">'
    + '<div class="lbl-head">'
    + '<span class="lbl-head-t">Auslager-Beleg</span>'
    + '<span class="lbl-head-d">' + d + '</span>'
    + '</div>'
    + '<div class="lbl-mid">'
    + '<span class="lbl-id">' + String(l).replace(/\B(?=(\d{3})+(?!\d))/g,'.') + '</span>'
    + '</div>'
    + '<div class="lbl-foot">'
    + '<span class="lbl-tech">' + t + '</span>'
    + '<span class="lbl-teil">' + e + '</span>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="footer">'
    + '<button class="btn btn-print" onclick="window.print()">🖨️ Label drucken</button>'
    + '<button class="btn btn-ok" onclick="google.script.host.close()">✓ Bestätigen</button>'
    + '</div>'
    + '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(420).setHeight(370),
    'EMTS Lagernaut'
  );
}


/**
 * Druckt das Auslager-Label der letzten abgeschlossenen Buchung (über Menü).
 * [F8] Fix: nutzt 'buchungsAbschluss' Property (war: 'letztesEtikett', wurde nie gesetzt)
 */
function letztesEtikettDrucken() {
  var raw = PropertiesService.getUserProperties().getProperty('buchungsAbschluss'); // [F8] gefixt
  if (!raw) {
    SpreadsheetApp.getUi().alert('Kein Etikett gefunden. Bitte erst eine Buchung abschließen.');
    return;
  }

  var d   = JSON.parse(raw);
  var html = '<!DOCTYPE html><html><head><base target="_top">'
    + '<meta charset="UTF-8">'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap" rel="stylesheet">'
    + '<style>'
    + 'body{font-family:Inter,sans-serif;padding:16px;background:#f0f2f5;margin:0}'
    + '.card{background:white;padding:16px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,0.1);max-width:380px;margin:0 auto}'
    + 'h3{margin:0 0 3px;font-size:14px}.sub{font-size:11px;color:#aaa;margin-bottom:14px}'
    + '.lbl{width:57mm;height:32mm;background:white;border:1.5px solid #333;border-radius:1mm;box-sizing:border-box;overflow:hidden;display:flex;flex-direction:row;margin:0 auto 14px;font-family:Arial,Helvetica,sans-serif}'
    + '.lbl-stripe{width:8mm;background:#000;display:flex;align-items:center;justify-content:center;flex-shrink:0}'
    + '.lbl-stripe-t{color:white;font-size:9.5px;font-weight:900;letter-spacing:3.5px;text-transform:uppercase;writing-mode:vertical-rl;transform:rotate(180deg)}'
    + '.lbl-main{flex:1;display:flex;flex-direction:column;overflow:hidden}'
    + '.lbl-head{padding:1.2mm 2.5mm 0.8mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-bottom:0.3mm solid #ddd}'
    + '.lbl-head-t{font-size:5.5px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.8px}'
    + '.lbl-head-d{font-size:7.5px;font-family:monospace;color:#333;font-weight:700}'
    + '.lbl-mid{flex:1;display:flex;align-items:center;justify-content:center;padding:0 2mm}'
    + '.lbl-id{font-size:21px;font-weight:900;color:#000;font-family:monospace;letter-spacing:2px;line-height:1}'
    + '.lbl-foot{padding:1mm 2.5mm 1.2mm;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;border-top:0.3mm solid #ddd}'
    + '.lbl-tech{font-size:10px;font-weight:900;color:#000}'
    + '.lbl-teil{font-size:11px;font-weight:800;color:#000;max-width:31mm;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}'
    + '.btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}'
    + '.btn{padding:9px;border-radius:9px;border:none;font-family:Inter,sans-serif;font-size:13px;font-weight:700;cursor:pointer}'
    + '.bp{background:#0064d2;color:white}.bs{background:#f0f2f5;color:#666;border:1.5px solid #e0e4ea}'
    + '@media print{'
    + '@page{size:57mm 32mm;margin:0}'
    + '.no-print{display:none!important}'
    + 'body{background:white!important;padding:0!important}'
    + '.lbl{border:none!important;border-radius:0!important;width:57mm!important;height:32mm!important;margin:0!important}'
    + '}'
    + '</style></head><body>'
    + '<div class="card no-print"><h3>🏷️ Auslager-Etikett</h3><p class="sub">Letzte abgeschlossene Buchung</p></div>'
    + '<div class="lbl">'
    + '<div class="lbl-stripe"><span class="lbl-stripe-t">EMTS</span></div>'
    + '<div class="lbl-main">'
    + '<div class="lbl-head">'
    + '<span class="lbl-head-t">Auslager-Beleg</span>'
    + '<span class="lbl-head-d">' + (d.datum||'') + '</span>'
    + '</div>'
    + '<div class="lbl-mid">'
    + '<span class="lbl-id">' + String((d.logId||'')).replace(/\B(?=(\d{3})+(?!\d))/g,'.') + '</span>'
    + '</div>'
    + '<div class="lbl-foot">'
    + '<span class="lbl-tech">' + (d.techniker||'') + '</span>'
    + '<span class="lbl-teil">' + (d.ersatzteil||'') + '</span>'
    + '</div>'
    + '</div>'
    + '</div>'
    + '<div class="card no-print" style="margin-top:10px"><div class="btns">'
    + '<button class="btn bs" onclick="google.script.host.close()">Schließen</button>'
    + '<button class="btn bp" onclick="window.print()">🖨️ Drucken</button>'
    + '</div></div>'
    + '</body></html>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(460).setHeight(340),
    '🏷️ Auslager-Etikett drucken'
  );
}


// ============================================================
// WEB APP / REPORT / EXPORT
// ============================================================

/**
 * Web App Einstiegspunkt.
 * ?page=report → ReportView
 * (alles andere) → Techniker-Portal
 */
function doGet(e) {
  let page = e.parameter.page;

  if (page === "report") {
    return HtmlService.createTemplateFromFile('ReportView')
        .evaluate()
        .setTitle('EMTS Lagernaut Deep-Dive Analyse')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Techniker')
      .evaluate()
      .setTitle('EMTS Lagernaut')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * Liefert Statistik-Daten für die ReportView (aktueller Monat).
 */
function getReportData() {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("Ersatzteil Anfrage");
    if (!sheet) return { monat: "Fehler: Tabelle nicht gefunden", stats: [] };

    const data      = sheet.getDataRange().getValues();
    const jetzt     = new Date();
    const zielMonat = jetzt.getMonth();
    const zielJahr  = jetzt.getFullYear();
    const monatsName = ["Januar","Februar","März","April","Mai","Juni",
                        "Juli","August","September","Oktober","November","Dezember"][zielMonat];

    const techStats = {};

    for (let i = 1; i < data.length; i++) {
      const zeitstempel = new Date(data[i][0]);
      if (!isNaN(zeitstempel.getTime()) &&
          zeitstempel.getMonth()    === zielMonat &&
          zeitstempel.getFullYear() === zielJahr) {

        const name   = String(data[i][1] || "Unbekannt").trim();
        const modell = String(data[i][3] || "Unbekannt").trim();
        const teil   = String(data[i][4] || "Unbekannt").trim();

        if (!techStats[name]) techStats[name] = { name, total: 0, models: {}, parts: {} };
        techStats[name].total++;
        techStats[name].models[modell] = (techStats[name].models[modell] || 0) + 1;
        techStats[name].parts[teil]    = (techStats[name].parts[teil]    || 0) + 1;
      }
    }

    const statsArray = Object.values(techStats).map(t => {
      const topModel   = Object.keys(t.models).sort((a,b) => t.models[b]-t.models[a])[0] || "Keins";
      const partsListe = Object.keys(t.parts)
        .sort((a,b) => t.parts[b]-t.parts[a])
        .map(p => p + " (" + t.parts[p] + "x)")
        .join(", ");
      return { name: t.name, total: t.total, topModel, allParts: partsListe };
    });

    return { monat: monatsName + " " + zielJahr, stats: statsArray };

  } catch (e) {
    console.log("Fehler in getReportData: " + e.message);
    return { monat: "Fehler", stats: [] };
  }
}


/**
 * Erstellt einen monatlichen Bericht und versendet ihn per E-Mail.
 * Sollte per Zeit-Trigger am 1. des Monats laufen.
 */
function sendeMonatsBericht() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ersatzteil Anfrage");
  const data  = sheet.getDataRange().getValues();
  const jetzt = new Date();

  let zielMonat = jetzt.getMonth();
  let zielJahr  = jetzt.getFullYear();
  const monatsName = ["Januar","Februar","März","April","Mai","Juni",
                      "Juli","August","September","Oktober","November","Dezember"][zielMonat];

  const stats = { eingegangen: 0, erledigt: 0, techs: {} };

  for (let i = 1; i < data.length; i++) {
    const zeitstempel = new Date(data[i][0]);
    if (zeitstempel.getMonth() === zielMonat && zeitstempel.getFullYear() === zielJahr) {
      const tech      = String(data[i][1]  || "Unbekannt").trim();
      const modell    = String(data[i][3]  || "Unbekannt").trim();
      const kategorie = String(data[i][4]  || "Unbekannt").trim();
      const status    = String(data[i][11]).trim();
      const istOk     = (status === "Abgeschlossen");

      stats.eingegangen++;
      if (istOk) stats.erledigt++;

      if (!stats.techs[tech]) stats.techs[tech] = { ok: 0, total: 0, models: {}, parts: {} };
      stats.techs[tech].total++;
      if (istOk) stats.techs[tech].ok++;
      stats.techs[tech].models[modell]    = (stats.techs[tech].models[modell]    || 0) + 1;
      stats.techs[tech].parts[kategorie]  = (stats.techs[tech].parts[kategorie] || 0) + 1;
    }
  }

  const webAppUrl = ScriptApp.getService().getUrl() + "?page=report";

  let html = `
    <div style="background-color:#f4f7f6;padding:20px;font-family:Arial,sans-serif;">
      <table align="center" border="0" cellpadding="0" cellspacing="0" width="600"
             style="background:#ffffff;border-radius:12px;border-collapse:separate;overflow:hidden;">
        <tr>
          <td align="center" bgcolor="#0078d4" style="padding:30px;color:#ffffff;">
            <h1 style="margin:0;font-size:24px;">EMTS Lagernaut Report</h1>
            <p style="margin:5px 0 0;opacity:0.8;">${monatsName} ${zielJahr} | Standort Sömmerda</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td width="48%" bgcolor="#e1f0ff" style="padding:15px;border-radius:8px;text-align:center;">
                  <span style="font-size:11px;color:#005a9e;font-weight:bold;text-transform:uppercase;">Eingegangen</span><br>
                  <span style="font-size:28px;font-weight:bold;color:#0078d4;">${stats.eingegangen}</span>
                </td>
                <td width="4%">&nbsp;</td>
                <td width="48%" bgcolor="#dff6dd" style="padding:15px;border-radius:8px;text-align:center;">
                  <span style="font-size:11px;color:#107c10;font-weight:bold;text-transform:uppercase;">Erledigt</span><br>
                  <span style="font-size:28px;font-weight:bold;color:#107c10;">${stats.erledigt}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 20px 20px;">
            <h3 style="color:#333;border-bottom:2px solid #eee;padding-bottom:10px;font-size:18px;">Techniker Übersicht</h3>
            ${Object.keys(stats.techs).map(t => `
              <table width="100%" border="0" cellpadding="0" cellspacing="0"
                     style="margin-bottom:10px;border:1px solid #eeeeee;border-radius:8px;background-color:#fafafa;">
                <tr><td style="padding:15px;">
                  <table width="100%" border="0" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:16px;font-weight:bold;color:#0078d4;">${t}</td>
                      <td align="right">
                        <span style="background-color:#0078d4;color:#ffffff;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:bold;">
                          ${stats.techs[t].total} Anfragen
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td colspan="2" style="font-size:13px;color:#666666;padding-top:8px;">
                        Häufigstes Modell: <b style="color:#333333;">${Object.keys(stats.techs[t].models).sort((a,b) => stats.techs[t].models[b]-stats.techs[t].models[a])[0] || "n/a"}</b>
                      </td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            `).join('')}
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:20px;">
              <tr><td align="center">
                <a href="${webAppUrl}"
                   style="background-color:#0078d4;color:#ffffff;padding:12px 25px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block;">
                  weitere Statistik öffnen
                </a>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="#f9f9f9" align="center" style="padding:15px;font-size:11px;color:#888888;">
            Dies ist ein automatisch generierter Bericht des EMTS Lagernaut.
          </td>
        </tr>
      </table>
    </div>
  `;

  MailApp.sendEmail({
    to: "ersatzteilmanagement.soem@afb-group.eu, frnksus@gmail.com",
    subject: `📊 EMTS Report ${monatsName} ${zielJahr}`,
    htmlBody: html
  });
}


/**
 * Exportiert alle Anfragen des aktuellen Monats als Base64-codierten CSV-String.
 * Das Frontend lädt die Datei daraus als Download.
 */
function getExcelExport() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Ersatzteil Anfrage");
  const data  = sheet.getDataRange().getValues();
  const jetzt = new Date();
  const zielMonat = jetzt.getMonth();

  let csvContent = "Datum;Techniker;LogID;Geraet;Ersatzteil;Status\n";

  for (let i = 1; i < data.length; i++) {
    const zeitstempel = new Date(data[i][0]);
    if (!isNaN(zeitstempel.getTime()) && zeitstempel.getMonth() === zielMonat) {
      const datum = Utilities.formatDate(zeitstempel, "GMT+1", "dd.MM.yyyy");
      csvContent += `${datum};${data[i][1]};${data[i][2]};${data[i][3]};${data[i][4]};${data[i][11]}\n`;
    }
  }

  return Utilities.base64Encode(csvContent, Utilities.Charset.UTF_8);
}


// ============================================================
// TRIGGER (installierbar)
// ============================================================

function installierbarerOnChange(e) {
  if (e.changeType === "REMOVE_ROW" || e.changeType === "OTHER") {
    initialerBestandsCheck();
  }
}

function onFormSubmit(e) {
  const range = e.range;
  const sheet = range.getSheet();
  sucheModellUndBestand(range.getRow(), sheet);
}