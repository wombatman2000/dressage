(() => {
'use strict';

/* ════════════════ Données & stockage ════════════════ */
const CLE = 'dressage.v1';
const JOUR = 864e5;
const FB_VERSION = '10.12.2';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (n = 14) => {
  const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(n))].map(x => a[x % a.length]).join('');
};

const defaut = () => ({
  version: 1,
  essais: [],                       // { id, ex, ok, t, qui, ctx, del? } — journal partagé
  reglages: { chien: 'Apollo', nbExos: 3, ordresInactifs: [], perso: [], debloques: [], maj: 0 }, // partagés
  moi: { prenom: '', ctx: 'maison' }, // propres à ce téléphone
  sync: { config: null, meute: null },
  seance: null
});

function charger() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE));
    if (s) {
      const d = defaut();
      return { ...d, ...s, reglages: { ...d.reglages, ...s.reglages }, moi: { ...d.moi, ...s.moi }, sync: { ...d.sync, ...s.sync } };
    }
  } catch (e) { /* stockage indisponible */ }
  return defaut();
}
let state = charger();
const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(state)); } catch (e) { /* ignore */ } };

const tousEx = () => [...window.EXERCICES, ...(state.reglages.perso || [])];
const exParId = id => tousEx().find(e => e.id === id);
const ordre = id => window.ORDRES.find(o => o.id === id) || { id, nom: id, mot: '', geste: '', emoji: '🐾' };
const chien = () => (state.reglages.chien || '').trim() || 'ton chien';
const perso = s => String(s ?? '').replaceAll('{chien}', chien());
const actif = o => !(state.reglages.ordresInactifs || []).includes(o);
const CTX = { maison: { emoji: '🏠', nom: 'À la maison' }, balade: { emoji: '🌳', nom: 'En balade' } };

/* ════════════════ Progression & répétition ════════════════ */
// Boîte de maîtrise 0 → 5 : +1 par réussite, −1 par échec.
// Plus la boîte est basse et plus les derniers essais sont ratés, plus l'exercice revient souvent.
const BASE = [10, 8, 6, 4, 2, 1];
const INTERVALLE = [0.5, 1, 2, 4, 8, 16]; // jours avant qu'un exercice redevienne "dû"

const essaisValides = () => state.essais.filter(e => !e.del).sort((a, b) => a.t - b.t);

function calculerStats() {
  const m = {};
  for (const e of essaisValides()) {
    const s = m[e.ex] || (m[e.ex] = { n: 0, ok: 0, boite: 0, dernier: 0, hist: [] });
    s.n++; s.dernier = e.t; s.hist.push(e.ok);
    if (e.ok) { s.ok++; s.boite = Math.min(5, s.boite + 1); } else s.boite = Math.max(0, s.boite - 1);
  }
  for (const s of Object.values(m)) {
    const r = s.hist.slice(-5);
    s.tauxEchec = r.filter(x => !x).length / r.length;
  }
  return m;
}

function estDebloque(ex, st) {
  if (ex.n === 1 || ex.perso) return true;
  if ((state.reglages.debloques || []).includes(ex.id)) return true;
  if (st[ex.id]) return true;
  return tousEx().some(x => x.o === ex.o && x.n === ex.n - 1 && (st[x.id]?.boite || 0) >= 3);
}

function poids(ex, st, now) {
  const s = st[ex.id];
  if (!s) return 6;
  const jours = (now - s.dernier) / JOUR;
  const du = Math.min(3, Math.max(0.2, (jours + 0.25) / INTERVALLE[s.boite]));
  return BASE[s.boite] * (1 + 3 * s.tauxEchec) * du;
}

function disponibles(ctx, st) {
  return tousEx().filter(e => actif(e.o) && e.ctx === ctx && estDebloque(e, st));
}

function tirer(ctx, n, exclure = []) {
  const st = calculerStats(), now = Date.now();
  let pool = disponibles(ctx, st).filter(e => !exclure.includes(e.id)).map(e => ({ e, w: poids(e, st, now) }));
  const choisis = [], ordresPris = new Set();
  while (choisis.length < n && pool.length) {
    let cand = pool.filter(p => !ordresPris.has(p.e.o));
    if (!cand.length) cand = pool;
    let r = Math.random() * cand.reduce((s, p) => s + p.w, 0);
    let pick = cand[cand.length - 1];
    for (const p of cand) { r -= p.w; if (r <= 0) { pick = p; break; } }
    choisis.push(pick.e.id); ordresPris.add(pick.e.o);
    pool = pool.filter(p => p !== pick);
  }
  return choisis;
}

const jourCle = t => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
function serie() {
  const jours = new Set(essaisValides().map(e => jourCle(e.t)));
  const d = new Date(); let n = 0;
  if (!jours.has(jourCle(d))) d.setDate(d.getDate() - 1);
  while (jours.has(jourCle(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function quand(t) {
  const a = new Date(); a.setHours(0, 0, 0, 0);
  const b = new Date(t); b.setHours(0, 0, 0, 0);
  const j = Math.round((a - b) / JOUR);
  const h = new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (j === 0) return "aujourd'hui à " + h;
  if (j === 1) return 'hier à ' + h;
  if (j < 7) return 'il y a ' + j + ' jours';
  return 'le ' + new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/* ════════════════ Essais ════════════════ */
function enregistrer(exId, ok) {
  const e = { id: uid(), ex: exId, ok: !!ok, t: Date.now(), qui: (state.moi.prenom || '').trim(), ctx: state.seance?.ctx || '' };
  state.essais.push(e); sauver(); sync.ecrireEssai(e);
  return e.id;
}
function annulerEssai(id) {
  const e = state.essais.find(x => x.id === id);
  if (e && !e.del) { e.del = true; sauver(); sync.ecrireEssai(e); }
}
function modifierReglages(fn) {
  fn(state.reglages);
  state.reglages.maj = Date.now();
  sauver(); sync.ecrireReglages();
}

/* ════════════════ Synchronisation (Firebase Firestore) ════════════════ */
// Chaque essai est un document immuable identifié par un id unique : la fusion est
// une simple union, sans conflit possible. Une annulation est un drapeau "del".
// Les réglages partagés suivent la règle « la dernière modification gagne ».
const sync = (() => {
  let fb = null, desab = [], deja = new Set();
  let statut = 'off', message = '';

  const propre = e => { const o = { id: e.id, ex: e.ex, ok: !!e.ok, t: e.t, qui: e.qui || '', ctx: e.ctx || '' }; if (e.del) o.del = true; return o; };
  const signature = e => e.id + (e.del ? ':x' : '');

  function majStatut(s, m = '') { statut = s; message = m; entete(); if (onglet === 'reglages' && !saisieEnCours()) rendre(); }

  async function demarrer() {
    arreter();
    const { config, meute } = state.sync;
    if (!config || !meute) { majStatut('off'); return; }
    majStatut('attente', 'Connexion…');
    try {
      const A = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app.js`);
      const F = await import(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-firestore.js`);
      const nom = 'dressage-' + config.projectId;
      const app = A.getApps().find(a => a.name === nom) || A.initializeApp(config, nom);
      const db = F.getFirestore(app);
      fb = { F, db, meute };
      const col = F.collection(db, 'meutes', meute, 'essais');
      desab.push(F.onSnapshot(col, { includeMetadataChanges: true }, snap => {
        fusionnerEssais(snap);
        majStatut(snap.metadata.fromCache ? 'attente' : 'ok', snap.metadata.fromCache ? 'Hors ligne, en attente' : 'Synchronisé');
      }, err => majStatut('erreur', libelleErreur(err))));
      desab.push(F.onSnapshot(F.doc(db, 'meutes', meute), snap => fusionnerReglages(snap), err => majStatut('erreur', libelleErreur(err))));
    } catch (e) {
      fb = null;
      majStatut('erreur', navigator.onLine ? 'Configuration Firebase invalide' : 'Hors ligne');
    }
  }
  function arreter() { desab.forEach(f => f()); desab = []; fb = null; deja = new Set(); }

  function libelleErreur(err) {
    const c = err?.code || '';
    if (c.includes('permission')) return 'Accès refusé : vérifie les règles Firestore';
    if (c.includes('not-found') || c.includes('failed-precondition')) return "Base Firestore introuvable : crée-la dans la console";
    if (c.includes('unavailable')) return 'Serveur injoignable';
    return 'Erreur : ' + (c || err?.message || 'inconnue');
  }

  function fusionnerEssais(snap) {
    const distants = new Map();
    snap.forEach(d => distants.set(d.id, d.data()));
    const locaux = new Map(state.essais.map(e => [e.id, e]));
    let change = false;
    for (const [id, r] of distants) {
      const l = locaux.get(id);
      if (!l) { if (r && r.ex) { state.essais.push(propre({ ...r, id })); change = true; } }
      else if (r.del && !l.del) { l.del = true; change = true; }
    }
    for (const l of state.essais) {
      const r = distants.get(l.id);
      if (!r || (l.del && !r.del)) ecrireEssai(l);
    }
    if (change) { sauver(); rafraichir(); }
  }

  function fusionnerReglages(snap) {
    const r = snap.exists() ? snap.data().reglages : null;
    const local = state.reglages.maj || 0, distant = r?.maj || 0;
    if (r && distant > local) { state.reglages = { ...defaut().reglages, ...r }; sauver(); rafraichir(); }
    else if (!r || local > distant) ecrireReglages();
  }

  function ecrireEssai(e) {
    if (!fb) return;
    const sig = signature(e);
    if (deja.has(sig)) return;
    deja.add(sig);
    const { F, db, meute } = fb;
    F.setDoc(F.doc(db, 'meutes', meute, 'essais', e.id), propre(e)).catch(err => { deja.delete(sig); majStatut('erreur', libelleErreur(err)); });
  }
  function ecrireReglages() {
    if (!fb) return;
    const { F, db, meute } = fb;
    F.setDoc(F.doc(db, 'meutes', meute), { reglages: JSON.parse(JSON.stringify(state.reglages)), maj: Date.now() }, { merge: true })
      .catch(err => majStatut('erreur', libelleErreur(err)));
  }

  return { demarrer, arreter, ecrireEssai, ecrireReglages, get statut() { return statut; }, get message() { return message; } };
})();

function lireConfigFirebase(txt) {
  const cfg = {};
  const re = /["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(txt))) cfg[m[1]] = m[2];
  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) return null;
  const garder = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  return Object.fromEntries(garder.filter(k => cfg[k]).map(k => [k, cfg[k]]));
}
const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64 = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
const codeInvitation = () => 'DRESSAGE-' + b64(JSON.stringify({ c: state.sync.config, m: state.sync.meute }));
function lireInvitation(txt) {
  try {
    const m = String(txt).trim().match(/DRESSAGE-([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const o = JSON.parse(deb64(m[1]));
    if (!o.c?.projectId || !o.m || o.m.length < 20) return null;
    return o;
  } catch (e) { return null; }
}

/* ════════════════ Interface ════════════════ */
let onglet = 'seance';
const saisieEnCours = () => { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName); };
function rafraichir() { entete(); if (!saisieEnCours() && !$('.sheet-bg')) rendre(); }

function entete() {
  $('#titre').textContent = state.reglages.chien?.trim() ? '🐕 ' + state.reglages.chien.trim() : 'Dressage';
  document.title = 'Dressage · ' + chien();
  const n = serie(), s = $('#serie');
  s.hidden = n === 0; s.textContent = '🔥 ' + n + ' j';
  const p = $('#sync');
  const partage = state.sync.config && state.sync.meute;
  p.hidden = !partage;
  if (partage) {
    const st = sync.statut;
    p.querySelector('.dot').className = 'dot ' + (st === 'ok' ? 'ok' : st === 'erreur' ? 'erreur' : 'attente');
    p.lastElementChild.textContent = st === 'ok' ? 'Partagé' : st === 'erreur' ? 'Erreur' : 'Hors ligne';
  }
}

function rendre() {
  document.querySelectorAll('nav [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === onglet ? 'page' : 'false'));
  const v = $('#vue');
  v.innerHTML = { seance: vueSeance, progres: vueProgres, exercices: vueExercices, reglages: vueReglages }[onglet]();
}

const niveau = n => `<span class="niv" aria-label="Niveau ${n}">${[1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
const maitrise = b => `<span class="maitrise" aria-label="Maîtrise ${b} sur 5">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= b ? 'on' : ''}"></i>`).join('')}</span>`;
const blocCue = o => {
  const ord = ordre(o);
  return `<div class="cue"><b>Mot</b><span>« ${esc(perso(ord.mot))} »</span>${ord.geste && ord.geste !== '—' ? `<b>Geste</b><span>${esc(ord.geste)}</span>` : ''}</div>`;
};
const etapesHtml = ex => `<ol class="etapes">${(ex.etapes || []).map(s => `<li>${esc(perso(s))}</li>`).join('')}</ol>`;

/* ─── Séance ─── */
function vueSeance() {
  const s = state.seance;
  if (s && s.fini) return vueFin();
  if (s && s.ctx === 'balade') return vueBalade();
  if (s) return vueMaison();

  const ctx = state.moi.ctx || 'maison';
  const st = calculerStats();
  const nb = Math.min(state.reglages.nbExos || 3, disponibles(ctx, st).length);
  const derniers = essaisValides();
  const dernier = derniers[derniers.length - 1];
  const aRevoir = Object.entries(st)
    .filter(([id, x]) => x.tauxEchec >= 0.4 && exParId(id) && actif(exParId(id).o))
    .sort((a, b) => b[1].tauxEchec - a[1].tauxEchec).slice(0, 3);

  return `
  <div class="seg" role="group" aria-label="Lieu">
    <button data-action="ctx" data-v="maison" aria-pressed="${ctx === 'maison'}">🏠 À la maison</button>
    <button data-action="ctx" data-v="balade" aria-pressed="${ctx === 'balade'}">🌳 En balade</button>
  </div>
  <div class="card hero">
    ${ctx === 'maison'
      ? `<h2>Séance à la maison</h2><p>${nb} exercice${nb > 1 ? 's' : ''} à enchaîner · environ 5 minutes.</p>`
      : `<h2>Missions de balade</h2><p>${nb} mission${nb > 1 ? 's' : ''} à glisser pendant la promenade, dans l'ordre qui t'arrange.</p>`}
    <button class="btn" data-action="commencer" ${nb ? '' : 'disabled'}>${ctx === 'maison' ? 'Commencer' : 'Partir en balade'}</button>
  </div>
  ${!nb ? `<p class="muted small">Aucun exercice disponible ici : active des ordres dans Réglages ou débloque des exercices.</p>` : ''}
  ${dernier ? `<p class="muted small" style="margin:0 4px 0">Dernier entraînement ${quand(dernier.t)}${dernier.qui ? ' avec ' + esc(dernier.qui) : ''}.</p>` : ''}
  ${aRevoir.length ? `<div class="section-t">À retravailler</div><div class="card"><ul class="liste">${aRevoir.map(([id, x]) => {
      const ex = exParId(id);
      return `<li><button class="ex-row" data-action="voir" data-id="${esc(id)}"><span style="font-size:22px">${ordre(ex.o).emoji}</span><span class="grow"><span class="t">${esc(perso(ex.t))}</span><br><span class="small muted">${CTX[ex.ctx]?.emoji || ''} ${esc(ordre(ex.o).nom)} · ${Math.round(x.tauxEchec * 100)} % ratés récemment</span></span></button></li>`;
    }).join('')}</ul><p class="small muted" style="margin:8px 0 0">Ils reviennent plus souvent dans les séances jusqu'à ce qu'ils passent.</p></div>` : ''}
  <div class="section-t">Les règles d'or</div>
  <div class="card"><details class="regles"><summary>Pour que ça marche vite</summary><ul class="small">
    <li>Séances courtes : 3 à 5 minutes, plusieurs fois par jour vaut mieux qu'une longue.</li>
    <li>« Oui ! » au moment exact de la bonne action, friandise dans la seconde.</li>
    <li>Un mot, une seule fois. Le même mot et le même geste pour tout le monde.</li>
    <li>Deux ratés de suite ? Simplifie (moins de distance, de durée, de distraction) et finis sur une réussite.</li>
    <li>« Ici » ne précède jamais quelque chose de désagréable.</li>
    <li>Note « Réussi » quand l'objectif affiché est atteint, sinon « Pas encore ».</li>
  </ul></details></div>`;
}

function vueMaison() {
  const s = state.seance;
  const item = s.file[s.i];
  const ex = exParId(item.ex);
  if (!ex) { s.i++; if (s.i >= s.file.length) s.fini = true; sauver(); return vueSeance(); }
  const ord = ordre(ex.o);
  const pct = Math.round(s.i / s.file.length * 100);
  return `
  <div class="etape-n"><span>Exercice ${s.i + 1} sur ${s.file.length}</span><button class="lien" data-action="quitter">Arrêter</button></div>
  <div class="progress" style="margin-bottom:12px"><i style="width:${pct}%"></i></div>
  <article class="card ex">
    <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:flex-start">
      <span class="chip" style="flex:none">${ord.emoji} ${esc(ord.nom)}</span>
      <span class="chip gris" style="flex:none">Niveau ${ex.n} ${niveau(ex.n)}</span>
      ${item.repris ? '<span class="chip rouille" style="flex:none">On réessaie</span>' : ''}
    </div>
    <h2>${esc(perso(ex.t))}</h2>
    ${blocCue(ex.o)}
    ${item.repris && ex.astuce ? `<p class="small" style="margin:0 0 6px"><b>Plus facile :</b> ${esc(perso(ex.astuce))}</p>` : ''}
    ${etapesHtml(ex)}
    <div class="objectif">🎯 <span>${esc(perso(ex.critere || 'Réussi quand il le fait du premier coup'))}</span></div>
    <div class="choix">
      <button class="btn ko" data-action="rate">✗ Pas encore</button>
      <button class="btn ok" data-action="reussi">✓ Réussi</button>
    </div>
    <div style="text-align:center;margin-top:6px"><button class="lien" data-action="passer">Passer cet exercice</button></div>
  </article>`;
}

function vueBalade() {
  const s = state.seance;
  const premierOuvert = s.file.findIndex((_, i) => !s.res[i]);
  return `
  <div class="etape-n"><span>Missions de balade · ${s.res.filter(Boolean).length}/${s.file.length}</span><button class="lien" data-action="quitter">Abandonner</button></div>
  ${s.file.map((item, i) => {
    const ex = exParId(item.ex); if (!ex) return '';
    const ord = ordre(ex.o), r = s.res[i];
    return `<details class="card mission" ${i === premierOuvert ? 'open' : ''}>
      <summary><span class="emo">${ord.emoji}</span><span><h3>${esc(perso(ex.t))}</h3><span class="small muted">${esc(ord.nom)} · niveau ${ex.n}</span></span>
      ${r ? `<span class="chip ${r.ok ? '' : 'rouille'}" style="margin-left:auto">${r.ok ? '✓' : '✗'}</span>` : `<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>`}
      </summary>
      ${blocCue(ex.o)}
      ${etapesHtml(ex)}
      <div class="objectif">🎯 <span>${esc(perso(ex.critere || ''))}</span></div>
      ${r ? `<div class="fait ${r.ok ? 'ok' : 'ko'}"><span>${r.ok ? '✓ Réussi' : '✗ Pas encore'}</span><button class="lien" data-action="m-annuler" data-i="${i}">Modifier</button></div>
             ${!r.ok && ex.astuce ? `<p class="small" style="margin:10px 0 0"><b>La prochaine fois :</b> ${esc(perso(ex.astuce))}</p>` : ''}`
           : `<div class="choix"><button class="btn ko" data-action="m-ko" data-i="${i}">✗ Pas encore</button><button class="btn ok" data-action="m-ok" data-i="${i}">✓ Réussi</button></div>`}
    </details>`;
  }).join('')}
  <button class="btn ${s.res.filter(Boolean).length ? '' : 'sec'}" data-action="terminer">Terminer la balade</button>`;
}

function vueFin() {
  const s = state.seance;
  const lignes = s.file.map((it, i) => ({ ex: exParId(it.ex), r: s.res[i] })).filter(x => x.ex);
  const ok = lignes.filter(x => x.r && x.r !== 'passe' && x.r.ok).length;
  const notes = lignes.filter(x => x.r && x.r !== 'passe').length;
  const ratio = notes ? ok / notes : 0;
  const titre = !notes ? 'Séance terminée' : ratio >= 0.75 ? `Bravo ${chien()} !` : ratio >= 0.4 ? 'Bonne séance' : 'On y retourne bientôt';
  const sous = !notes ? "Rien de noté cette fois." : ratio >= 0.4 ? `${ok} réussi${ok > 1 ? 's' : ''} sur ${notes}.` : `${ok} réussi${ok > 1 ? 's' : ''} sur ${notes}. Les ratés reviendront plus souvent.`;
  return `
  <div class="card fin">
    <div class="big">${!notes ? '🐾' : ratio >= 0.75 ? '🏆' : ratio >= 0.4 ? '🐕' : '💪'}</div>
    <h2>${esc(titre)}</h2>
    <p class="muted" style="margin:0">${sous}</p>
  </div>
  <div class="card"><ul class="liste">${lignes.map(({ ex, r }) => `<li><span style="font-size:20px">${ordre(ex.o).emoji}</span><span class="grow t">${esc(perso(ex.t))}</span>
    ${!r ? '<span class="chip gris">—</span>' : r === 'passe' ? '<span class="chip gris">passé</span>' : r.ok ? '<span class="chip">✓</span>' : '<span class="chip rouille">✗</span>'}</li>`).join('')}</ul></div>
  <div class="row"><button class="btn sec" data-action="encore">+1 exercice</button><button class="btn" data-action="fin-ok">Terminer</button></div>`;
}

/* ─── Progrès ─── */
function vueProgres() {
  const valides = essaisValides();
  if (!valides.length) return `<div class="vide"><div style="font-size:44px">📈</div><h2 style="margin:8px 0 4px">Pas encore d'essais</h2><p>Lance une séance : chaque « Réussi » ou « Pas encore » apparaît ici.</p></div>`;
  const st = calculerStats();
  const il7 = Date.now() - 7 * JOUR;
  const sem = valides.filter(e => e.t >= il7);
  const taux = sem.length ? Math.round(sem.filter(e => e.ok).length / sem.length * 100) : 0;
  const ordres = window.ORDRES.filter(o => actif(o.id));
  const parOrdre = ordres.map(o => {
    const exs = tousEx().filter(e => e.o === o.id);
    const total = exs.length * 5 || 1;
    const somme = exs.reduce((a, e) => a + (st[e.id]?.boite || 0), 0);
    const nivMax = Math.max(1, ...exs.filter(e => estDebloque(e, st)).map(e => e.n));
    const echec = exs.some(e => st[e.id] && st[e.id].tauxEchec >= 0.4);
    return { o, pct: Math.round(somme / total * 100), nivMax, echec };
  });
  const participants = [...new Set(valides.map(e => e.qui).filter(Boolean))];
  return `
  <div class="stats">
    <div class="stat"><b>${serie()}</b><span>jour${serie() > 1 ? 's' : ''} d'affilée</span></div>
    <div class="stat"><b>${sem.length}</b><span>essais sur 7 j</span></div>
    <div class="stat"><b>${sem.length ? taux + ' %' : '—'}</b><span>de réussite</span></div>
  </div>
  <div class="section-t">Par ordre</div>
  <div class="card" style="padding:4px 16px">${parOrdre.map(x => `
    <div class="ordre-p"><span class="e">${x.o.emoji}</span><span><b>${esc(x.o.nom)}</b> ${x.echec ? '<span class="chip rouille" style="font-size:11px;padding:2px 7px">à revoir</span>' : ''}</span><span class="small muted">niv. ${x.nivMax}/3</span>
    <div class="progress"><i style="width:${x.pct}%"></i></div></div>`).join('')}</div>
  ${participants.length > 1 ? `<div class="section-t">Qui l'entraîne</div><div class="card"><ul class="liste">${participants.map(p => {
      const ses = valides.filter(e => e.qui === p);
      return `<li><span class="grow t">${esc(p)}</span><span class="small muted">${ses.length} essais · ${Math.round(ses.filter(e => e.ok).length / ses.length * 100)} %</span></li>`;
    }).join('')}</ul></div>` : ''}
  <div class="section-t">Historique</div>
  <div class="card"><ul class="liste">${valides.slice(-25).reverse().map(e => {
    const ex = exParId(e.ex);
    return `<li><span style="font-size:20px">${ex ? ordre(ex.o).emoji : '🐾'}</span><span class="grow"><span class="t">${esc(ex ? perso(ex.t) : 'Exercice supprimé')}</span><br><span class="small muted">${quand(e.t)}${e.qui ? ' · ' + esc(e.qui) : ''}</span></span>${e.ok ? '<span class="chip">✓</span>' : '<span class="chip rouille">✗</span>'}</li>`;
  }).join('')}</ul></div>`;
}

/* ─── Exercices ─── */
function vueExercices() {
  const st = calculerStats();
  const ordres = window.ORDRES.filter(o => actif(o.id));
  return `
  <button class="btn sec" data-action="ajout" style="margin:4px 0 4px">＋ Ajouter un exercice</button>
  ${ordres.map(o => {
    const exs = tousEx().filter(e => e.o === o.id).sort((a, b) => a.n - b.n || (a.ctx > b.ctx ? 1 : -1));
    if (!exs.length) return '';
    return `<div class="section-t">${o.emoji} ${esc(o.nom)} <span style="text-transform:none;letter-spacing:0;font-weight:500">· « ${esc(perso(o.mot))} »</span></div>
    <div class="card" style="padding:4px 16px"><ul class="liste">${exs.map(e => {
      const ok = estDebloque(e, st), s = st[e.id];
      return `<li class="${ok ? '' : 'lock'}"><button class="ex-row" data-action="voir" data-id="${esc(e.id)}">
        <span style="font-size:20px">${CTX[e.ctx]?.emoji || '🐾'}</span>
        <span class="grow"><span class="t">${esc(perso(e.t))}</span><br><span class="small muted">${niveau(e.n)} ${e.perso ? '· perso' : ''} ${s ? '· ' + s.ok + '/' + s.n : ''}</span></span>
        ${ok ? maitrise(s?.boite || 0) : '<span aria-label="Verrouillé">🔒</span>'}</button></li>`;
    }).join('')}</ul></div>`;
  }).join('')}`;
}

function feuilleExercice(id) {
  const ex = exParId(id); if (!ex) return;
  const st = calculerStats(), s = st[id], ok = estDebloque(ex, st), ord = ordre(ex.o);
  feuille(`
    <div class="row" style="flex-wrap:wrap;gap:6px;justify-content:flex-start">
      <span class="chip" style="flex:none">${ord.emoji} ${esc(ord.nom)}</span>
      <span class="chip gris" style="flex:none">${CTX[ex.ctx].emoji} ${CTX[ex.ctx].nom}</span>
      <span class="chip gris" style="flex:none">Niveau ${ex.n} ${niveau(ex.n)}</span>
    </div>
    <h2 style="font-size:23px;margin:10px 0 6px">${esc(perso(ex.t))}</h2>
    ${blocCue(ex.o)}
    ${etapesHtml(ex)}
    <div class="objectif">🎯 <span>${esc(perso(ex.critere || ''))}</span></div>
    ${ex.astuce ? `<p class="small"><b>Si ça coince :</b> ${esc(perso(ex.astuce))}</p>` : ''}
    <p class="small muted">${s ? `${s.n} essai${s.n > 1 ? 's' : ''} · ${s.ok} réussi${s.ok > 1 ? 's' : ''} · dernier ${quand(s.dernier)} · maîtrise ${maitrise(s.boite)}` : 'Jamais essayé.'}
    ${!ok ? `<br>Se débloque quand un exercice de niveau ${ex.n - 1} en ${esc(ord.nom)} a 3 réussites d'avance.` : ''}</p>
    ${ok ? `<button class="btn" data-action="faire" data-id="${esc(id)}">Faire maintenant</button>`
         : `<button class="btn ocre" data-action="debloquer" data-id="${esc(id)}">Débloquer quand même</button>`}
    ${ex.perso ? `<button class="btn danger" style="margin-top:10px" data-action="suppr-perso" data-id="${esc(id)}">Supprimer cet exercice</button>` : ''}`);
}

function feuilleAjout() {
  feuille(`
    <h2 style="font-size:22px">Nouvel exercice</h2>
    <label class="f" for="nx-o">Ordre</label>
    <select id="nx-o">${window.ORDRES.map(o => `<option value="${o.id}">${o.emoji} ${esc(o.nom)}</option>`).join('')}</select>
    <label class="f" for="nx-t">Titre</label>
    <input type="text" id="nx-t" placeholder="Ex. Assis devant la gamelle">
    <label class="f" for="nx-c">Où</label>
    <select id="nx-c"><option value="maison">🏠 À la maison</option><option value="balade">🌳 En balade</option></select>
    <label class="f" for="nx-e">Étapes (une par ligne)</label>
    <textarea id="nx-e" class="prose" placeholder="Une étape par ligne"></textarea>
    <label class="f" for="nx-r">Objectif pour noter « Réussi »</label>
    <input type="text" id="nx-r" placeholder="Ex. 5 fois sur 5">
    <button class="btn" style="margin-top:16px" data-action="save-ex">Ajouter</button>`);
}

/* ─── Réglages ─── */
function vueReglages() {
  const r = state.reglages;
  return `
  <div class="section-t">Le chien</div>
  <div class="card">
    <label class="f" for="f-chien" style="margin-top:0">Nom du chien</label>
    <input type="text" id="f-chien" data-field="chien" value="${esc(r.chien)}" autocomplete="off">
    <label class="f" for="f-prenom">Ton prénom</label>
    <input type="text" id="f-prenom" data-field="prenom" value="${esc(state.moi.prenom)}" placeholder="Affiché dans l'historique partagé" autocomplete="given-name">
    <label class="f" for="f-nb">Exercices par séance</label>
    <select id="f-nb" data-field="nbExos">${[2, 3, 4, 5, 6].map(n => `<option ${n === (r.nbExos || 3) ? 'selected' : ''}>${n}</option>`).join('')}</select>
  </div>

  <div class="section-t">Ordres travaillés</div>
  <div class="card" style="padding:4px 16px">${window.ORDRES.map(o => `
    <label class="switch"><span>${o.emoji} ${esc(o.nom)} <span class="small muted">« ${esc(perso(o.mot))} »</span></span>
    <input type="checkbox" data-ordre="${o.id}" ${actif(o.id) ? 'checked' : ''}></label>`).join('')}</div>

  <div class="section-t">Partage et synchronisation</div>
  ${blocSync()}

  <div class="section-t">Rappels sur l'iPhone</div>
  ${blocRappels()}

  <div class="section-t">Sauvegarde</div>
  <div class="card">
    <p class="small muted" style="margin-top:0">Exporte tout l'historique dans un fichier, ou fusionne un fichier exporté depuis un autre téléphone.</p>
    <div class="row"><button class="btn sec petit" data-action="exporter">Exporter</button>
    <label class="btn sec petit" style="cursor:pointer">Importer<input type="file" accept="application/json,.json" id="f-import" hidden></label></div>
  </div>
  <p class="small muted" style="text-align:center;margin:20px 0">Dressage · ${state.essais.filter(e => !e.del).length} essais enregistrés</p>`;
}

function blocSync() {
  const { config, meute } = state.sync;
  if (config && meute) {
    const st = sync.statut;
    return `<div class="card">
      <p style="margin-top:0;display:flex;align-items:center;gap:8px"><span class="dot ${st === 'ok' ? 'ok' : st === 'erreur' ? 'erreur' : 'attente'}"></span><b>${esc(sync.message || 'Connexion…')}</b></p>
      <p class="small muted">La progression de ${esc(chien())} est partagée. Chaque essai noté sur un téléphone apparaît sur l'autre, même s'il a été fait hors ligne.</p>
      <button class="btn" data-action="inviter">Inviter quelqu'un</button>
      <div style="text-align:center;margin-top:6px"><button class="lien" data-action="sync-quitter" style="color:var(--rouille)">Arrêter le partage sur ce téléphone</button></div>
    </div>`;
  }
  const rejoindre = `<label class="f" for="f-inv">Tu as reçu un code d'invitation ?</label>
    <input type="text" id="f-inv" placeholder="DRESSAGE-…" autocomplete="off" autocapitalize="off">
    <button class="btn sec" style="margin-top:10px" data-action="rejoindre">Rejoindre</button>`;
  if (config) {
    return `<div class="card">
      <p style="margin-top:0"><b>Firebase est configuré</b> <span class="small muted">(projet ${esc(config.projectId)})</span>.</p>
      <p class="small muted">Crée le partage : tes essais actuels y seront envoyés, puis tu pourras inviter quelqu'un.</p>
      <button class="btn" data-action="creer">Créer le partage</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0 4px">${rejoindre}
      <div style="text-align:center;margin-top:6px"><button class="lien" data-action="effacer-config">Changer de configuration</button></div>
    </div>`;
  }
  return `<div class="card">
    <p class="small" style="margin-top:0">Pour entraîner ${esc(chien())} à deux avec la même progression, l'appli s'appuie sur une petite base gratuite (Firebase, de Google). Une seule personne la crée, l'autre reçoit simplement un code.</p>
    ${rejoindre}
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0 4px">
    <details><summary style="font-weight:700;cursor:pointer;padding:8px 0">Créer la base (5 minutes, une seule fois)</summary>
    <ol class="steps-guide small">
      <li>Sur <b>console.firebase.google.com</b>, crée un projet (Google Analytics n'est pas utile).</li>
      <li>Dans le menu, ouvre <b>Firestore Database</b> › <b>Créer une base de données</b>, choisis un emplacement en Europe et le <b>mode production</b>.</li>
      <li>Onglet <b>Règles</b> : remplace tout par le texte ci-dessous, puis <b>Publier</b>.</li>
      <li>Roue dentée › <b>Paramètres du projet</b> › <b>Vos applications</b> › icône <b>&lt;/&gt;</b> (Web), nom « Dressage ». Copie le bloc <code>firebaseConfig</code> et colle-le plus bas.</li>
    </ol>
    <div class="code" id="regles">${esc(REGLES)}</div>
    <button class="lien" data-action="copier" data-src="regles">Copier les règles</button>
    <label class="f" for="f-cfg">Configuration Firebase</label>
    <textarea id="f-cfg" placeholder="const firebaseConfig = { apiKey: &quot;…&quot;, … }"></textarea>
    <button class="btn" style="margin-top:10px" data-action="save-config">Enregistrer</button>
    </details>
  </div>`;
}

const REGLES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /meutes/{meute} {
      allow get, create, update: if meute.size() >= 20;
      match /essais/{essai} {
        allow read, create, update: if meute.size() >= 20;
      }
    }
  }
}`;

function blocRappels() {
  const txtMaison = `🐕 5 minutes de dressage avec ${chien()} ?`;
  const txtBalade = `🌳 Balade avec ${chien()} : ouvre tes missions !`;
  return `<div class="card">
    <p class="small" style="margin-top:0">Une app web ne peut pas savoir seule que tu es rentré. L'app <b>Raccourcis</b> d'iOS le fait très bien :</p>
    <ol class="steps-guide small">
      <li>Raccourcis › onglet <b>Automatisation</b> › <b>+</b>.</li>
      <li>Choisis <b>Arriver</b>, lieu : <b>ton domicile</b>, puis <b>Exécuter immédiatement</b>.</li>
      <li>Suivant › <b>Nouveau raccourci vide</b> › ajoute l'action <b>Afficher une notification</b> avec ce texte :</li>
    </ol>
    <div class="code" id="txt-maison">${esc(txtMaison)}</div>
    <button class="lien" data-action="copier" data-src="txt-maison">Copier</button>
    <p class="small" style="margin-bottom:6px">Pour la balade, crée la même automatisation avec <b>Partir</b> de ton domicile :</p>
    <div class="code" id="txt-balade">${esc(txtBalade)}</div>
    <button class="lien" data-action="copier" data-src="txt-balade">Copier</button>
    <p class="small muted" style="margin-bottom:0">Chaque personne qui partage l'appli fait la même chose sur son téléphone. Touche la notification puis ouvre Dressage depuis l'écran d'accueil.</p>
  </div>`;
}

/* ─── Feuille & toast ─── */
function feuille(html) {
  fermerFeuille();
  const t = $('.toast'); if (t) t.remove();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="poignee"></div>${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) fermerFeuille(); });
  document.body.appendChild(bg);
}
function fermerFeuille() { const s = $('.sheet-bg'); if (s) s.remove(); }
let toastTimer;
function toast(msg, action, fn) {
  const t = $('.toast'); if (t) t.remove();
  clearTimeout(toastTimer);
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); fn(); };
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 4500);
}
async function copier(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Copié'); }
  catch (e) { toast('Copie impossible : sélectionne le texte'); }
}

/* ════════════════ Actions ════════════════ */
function demarrerSeance(ctx, ids) {
  state.seance = { ctx, file: ids.map(ex => ({ ex })), i: 0, res: [], debut: Date.now() };
  sauver();
}

const actions = {
  ctx: el => { state.moi.ctx = el.dataset.v; sauver(); rendre(); },
  commencer: () => {
    const ctx = state.moi.ctx || 'maison';
    const ids = tirer(ctx, state.reglages.nbExos || 3);
    if (!ids.length) return;
    demarrerSeance(ctx, ids); rendre(); scrollTo(0, 0);
  },
  reussi: () => {
    const s = state.seance, item = s.file[s.i];
    const id = enregistrer(item.ex, true);
    s.res[s.i] = { ok: true, id }; s.i++;
    if (s.i >= s.file.length) s.fini = true;
    sauver(); rendre(); entete(); scrollTo(0, 0);
    toast('Réussi ✓', 'Annuler', () => {
      annulerEssai(id); s.fini = false; s.i--; s.res[s.i] = null; sauver(); rendre(); entete();
    });
  },
  rate: () => {
    const s = state.seance, item = s.file[s.i], ex = exParId(item.ex);
    const id = enregistrer(item.ex, false);
    s.res[s.i] = { ok: false, id };
    let reprise = false;
    if (!item.repris) { s.file.push({ ex: item.ex, repris: true }); reprise = true; }
    sauver();
    feuille(`
      <h2 style="font-size:22px">Pas grave, on simplifie</h2>
      ${ex.astuce ? `<p>${esc(perso(ex.astuce))}</p>` : '<p>Rends l\'exercice plus facile et termine sur une réussite.</p>'}
      <p class="small muted">${reprise ? 'On le refait en fin de séance, en plus facile. ' : ''}Il reviendra plus souvent dans les prochaines séances.</p>
      <button class="btn" data-action="apres-rate">Continuer</button>
      <div style="text-align:center;margin-top:6px"><button class="lien" data-action="annuler-rate" data-reprise="${reprise ? 1 : 0}">Annuler, je me suis trompé</button></div>`);
  },
  'apres-rate': () => {
    const s = state.seance; s.i++;
    if (s.i >= s.file.length) s.fini = true;
    sauver(); fermerFeuille(); rendre(); scrollTo(0, 0);
  },
  'annuler-rate': el => {
    const s = state.seance;
    annulerEssai(s.res[s.i].id); s.res[s.i] = null;
    if (el.dataset.reprise === '1') s.file.pop();
    sauver(); fermerFeuille(); rendre();
  },
  passer: () => {
    const s = state.seance; s.res[s.i] = 'passe'; s.i++;
    if (s.i >= s.file.length) s.fini = true;
    sauver(); rendre(); scrollTo(0, 0);
  },
  quitter: () => {
    const s = state.seance;
    if (s.res.some(r => r && r !== 'passe')) { s.fini = true; } else state.seance = null;
    sauver(); rendre();
  },
  'm-ok': el => noterMission(+el.dataset.i, true),
  'm-ko': el => noterMission(+el.dataset.i, false),
  'm-annuler': el => {
    const s = state.seance, i = +el.dataset.i;
    if (s.res[i]?.id) annulerEssai(s.res[i].id);
    s.res[i] = null; sauver(); rendre(); entete();
    const d = document.querySelectorAll('.mission')[i]; if (d) d.open = true;
  },
  terminer: () => { state.seance.fini = true; sauver(); rendre(); scrollTo(0, 0); },
  encore: () => {
    const s = state.seance;
    const ids = tirer(s.ctx, 1, s.file.map(f => f.ex));
    if (!ids.length) { toast('Plus d\'exercice disponible'); return; }
    s.file.push({ ex: ids[0] }); s.fini = false;
    if (s.ctx === 'maison') s.i = s.file.length - 1;
    sauver(); rendre(); scrollTo(0, 0);
  },
  'fin-ok': () => { state.seance = null; sauver(); rendre(); },
  voir: el => feuilleExercice(el.dataset.id),
  faire: el => {
    const ex = exParId(el.dataset.id);
    demarrerSeance(ex.ctx, [ex.id]); state.moi.ctx = ex.ctx; sauver();
    fermerFeuille(); onglet = 'seance'; rendre(); scrollTo(0, 0);
  },
  debloquer: el => {
    const id = el.dataset.id;
    modifierReglages(r => { r.debloques = [...new Set([...(r.debloques || []), id])]; });
    feuilleExercice(id); rendre();
  },
  'suppr-perso': el => {
    if (!confirm('Supprimer cet exercice ?')) return;
    const id = el.dataset.id;
    modifierReglages(r => { r.perso = (r.perso || []).filter(e => e.id !== id); });
    fermerFeuille(); rendre();
  },
  ajout: () => feuilleAjout(),
  'save-ex': () => {
    const t = $('#nx-t').value.trim();
    const etapes = $('#nx-e').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!t || !etapes.length) { toast('Ajoute un titre et au moins une étape'); return; }
    const ex = { id: 'x' + uid(8), o: $('#nx-o').value, n: 1, ctx: $('#nx-c').value, t, etapes, critere: $('#nx-r').value.trim(), astuce: '', perso: true };
    modifierReglages(r => { r.perso = [...(r.perso || []), ex]; r.ordresInactifs = (r.ordresInactifs || []).filter(o => o !== ex.o); });
    fermerFeuille(); rendre(); toast('Exercice ajouté');
  },
  'save-config': () => {
    const cfg = lireConfigFirebase($('#f-cfg').value);
    if (!cfg) { toast('Configuration incomplète (apiKey, projectId, appId)'); return; }
    state.sync.config = cfg; sauver(); rendre();
  },
  'effacer-config': () => { state.sync = { config: null, meute: null }; sauver(); sync.arreter(); rendre(); entete(); },
  creer: () => {
    state.sync.meute = uid(24); sauver();
    sync.demarrer(); rendre(); entete();
    toast('Partage créé');
  },
  rejoindre: () => {
    const inv = lireInvitation($('#f-inv').value);
    if (!inv) { toast("Code d'invitation non reconnu"); return; }
    state.sync = { config: inv.c, meute: inv.m };
    state.reglages.maj = 0; // les réglages du groupe l'emportent
    sauver(); sync.demarrer(); rendre(); entete();
    toast('Partage rejoint');
  },
  inviter: () => {
    const code = codeInvitation();
    feuille(`
      <h2 style="font-size:22px">Inviter quelqu'un</h2>
      <ol class="steps-guide small">
        <li>Envoie-lui le lien de l'appli et ce code.</li>
        <li>Il ou elle ajoute l'appli à l'écran d'accueil (Safari › Partager › Sur l'écran d'accueil), l'ouvre, puis colle le code dans Réglages › Rejoindre.</li>
      </ol>
      <div class="code" id="code-inv">${esc(code)}</div>
      <div class="row" style="margin-top:12px">
        <button class="btn sec" data-action="copier" data-src="code-inv">Copier</button>
        ${navigator.share ? '<button class="btn" data-action="partager">Partager</button>' : ''}
      </div>
      <p class="small muted">Ce code donne accès à la progression de ${esc(chien())} : ne l'envoie qu'aux personnes concernées.</p>`);
  },
  partager: () => {
    const url = location.href.split('#')[0];
    navigator.share({ title: 'Dressage', text: `Rejoins-moi pour entraîner ${chien()} !\n1. Ouvre ${url} et ajoute-la à l'écran d'accueil.\n2. Réglages › Rejoindre, colle ce code :\n${codeInvitation()}` }).catch(() => {});
  },
  'sync-quitter': () => {
    if (!confirm("Arrêter le partage sur ce téléphone ? L'historique reste enregistré ici.")) return;
    state.sync.meute = null; sauver(); sync.arreter(); rendre(); entete();
  },
  copier: el => copier($('#' + el.dataset.src).textContent),
  exporter: async () => {
    const data = JSON.stringify({ app: 'dressage', version: 1, essais: state.essais, reglages: state.reglages }, null, 1);
    const nom = `dressage-${chien().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    const fichier = new File([data], nom, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
      try { await navigator.share({ files: [fichier], title: nom }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(fichier); a.download = nom; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
};

function noterMission(i, ok) {
  const s = state.seance;
  if (s.res[i]) return;
  const id = enregistrer(s.file[i].ex, ok);
  s.res[i] = { ok, id };
  sauver(); rendre(); entete();
  if (!ok) { const d = document.querySelectorAll('.mission')[i]; if (d) { d.open = true; } }
  toast(ok ? 'Mission réussie ✓' : 'Noté : à retravailler');
}

function importer(fichier) {
  const lr = new FileReader();
  lr.onload = () => {
    try {
      const d = JSON.parse(lr.result);
      if (!Array.isArray(d.essais)) throw new Error();
      const locaux = new Map(state.essais.map(e => [e.id, e]));
      let n = 0;
      for (const e of d.essais) {
        if (!e || !e.id || !e.ex) continue;
        const l = locaux.get(e.id);
        if (!l) { state.essais.push(e); n++; sync.ecrireEssai(e); }
        else if (e.del && !l.del) { l.del = true; sync.ecrireEssai(l); }
      }
      if (d.reglages && (d.reglages.maj || 0) > (state.reglages.maj || 0)) { state.reglages = { ...defaut().reglages, ...d.reglages }; sync.ecrireReglages(); }
      sauver(); rendre(); entete();
      toast(n + ' essai' + (n > 1 ? 's' : '') + ' importé' + (n > 1 ? 's' : ''));
    } catch (e) { toast('Fichier non reconnu'); }
  };
  lr.readAsText(fichier);
}

/* ════════════════ Événements ════════════════ */
document.addEventListener('click', e => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { onglet = tab.dataset.tab; fermerFeuille(); rendre(); scrollTo(0, 0); return; }
  const a = e.target.closest('[data-action]');
  if (a && actions[a.dataset.action]) { e.preventDefault(); actions[a.dataset.action](a); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.field === 'chien') { modifierReglages(r => { r.chien = el.value.trim(); }); entete(); }
  else if (el.dataset.field === 'prenom') { state.moi.prenom = el.value.trim(); sauver(); }
  else if (el.dataset.field === 'nbExos') modifierReglages(r => { r.nbExos = +el.value; });
  else if (el.dataset.ordre) {
    const o = el.dataset.ordre, on = el.checked;
    modifierReglages(r => { const s = new Set(r.ordresInactifs || []); on ? s.delete(o) : s.add(o); r.ordresInactifs = [...s]; });
  }
  else if (el.id === 'f-import' && el.files[0]) importer(el.files[0]);
});
window.addEventListener('online', () => { if (state.sync.meute && sync.statut === 'erreur') sync.demarrer(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) rafraichir(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

// Lien d'invitation éventuel : …/#DRESSAGE-xxxx
const invHash = lireInvitation(decodeURIComponent(location.hash.slice(1)));
if (invHash && !state.sync.meute) {
  state.sync = { config: invHash.c, meute: invHash.m }; state.reglages.maj = 0; sauver();
  history.replaceState(null, '', location.pathname);
}

entete(); rendre(); sync.demarrer();

// Accès pour les tests
window.__dressage = { get state() { return state; }, tirer, calculerStats, poids, estDebloque };
})();
