// api/src/functions/demande.js — Azure Functions v4 (fonctions managées Static Web Apps)
// Rôle : point d'entrée UNIQUE de tous les formulaires du portail.
// Il ne contient aucune logique métier : il filtre le bruit et relaie
// au flux Power Automate dont l'URL (avec sa signature) reste secrète
// dans la configuration de la Static Web App — jamais dans le HTML.
//
// Configuration (portail Azure > Static Web App > Variables d'environnement) :
//   FLOW_URL_ATTESTATION_EMPLOYEUR = https://prod-xx.westeurope.logic.azure.com/workflows/...
//   (une variable par démarche : FLOW_URL_<DEMARCHE_EN_MAJUSCULES_SOULIGNEES>)

const { app } = require("@azure/functions");

const CHAMPS_REQUIS = ["demarche", "client", "email"];

app.http("demande", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    let d;
    try { d = await request.json(); }
    catch { return { status: 400, jsonBody: { erreur: "JSON attendu" } }; }

    // 1. Honeypot : un humain ne remplit jamais ce champ caché
    if (d.website) return { status: 202, jsonBody: { reference: "OK" } }; // on ne renseigne pas le bot

    // 2. Champs minimaux + email plausible
    for (const c of CHAMPS_REQUIS) {
      if (!d[c] || typeof d[c] !== "string" || !d[c].trim())
        return { status: 400, jsonBody: { erreur: `Champ manquant : ${c}` } };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email))
      return { status: 400, jsonBody: { erreur: "Email invalide" } };

    // 3. Résolution du flux cible à partir de la démarche
    //    "attestation-employeur" -> FLOW_URL_ATTESTATION_EMPLOYEUR
    const cle = "FLOW_URL_" + d.demarche.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    const flowUrl = process.env[cle];
    if (!flowUrl) {
      context.warn(`Démarche inconnue ou non configurée : ${d.demarche}`);
      return { status: 400, jsonBody: { erreur: "Démarche non reconnue" } };
    }

    // 4. Référence lisible, renvoyée au client et transmise au flux
    const reference = `${d.demarche.split("-")[0].toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

    // 5. Relais vers Power Automate (le flux fait tout le reste :
    //    liste blanche email, journal, approbation, Word, PDF, accusé)
    delete d.website;
    const r = await fetch(flowUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...d, reference, recuLe: new Date().toISOString() })
    });

    if (!r.ok) {
      context.error(`Relais flux ${cle} en échec : ${r.status}`);
      return { status: 502, jsonBody: { erreur: "Prise en charge momentanément indisponible, réessayez ou écrivez-nous." } };
    }

    return { status: 202, jsonBody: { reference } };
  }
});
