import type { Connection } from './domain.js';

export const escapeHTML = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeHTML(title)} · Banxo Widget</title><link rel="stylesheet" href="/style.css"></head><body><main><header><span class="mark">B.</span><span>Banxo Widget<small>Espace personnel</small></span></header>${body}<footer>Accès en lecture seule · Projet personnel indépendant de Caisse d’Épargne</footer></main></body></html>`;
}
export const stylesheet = `:root{font:16px/1.6 system-ui,sans-serif;color:#e9ecf1;background:#10141b;color-scheme:dark}*{box-sizing:border-box}body{margin:0}main{max-width:760px;margin:48px auto;padding:24px}header{display:flex;align-items:center;gap:14px;font-weight:650;font-size:20px;margin-bottom:40px}.mark{display:grid;place-items:center;background:#c94956;color:white;width:48px;height:48px;border-radius:16px;font-size:26px}small{display:block;color:#9ea9b8;font-size:13px;font-weight:400}h1{font-size:32px;letter-spacing:-1px}h2{font-size:20px;margin-top:0}section{border:1px solid #303845;background:#191f29;padding:24px;border-radius:20px;margin:20px 0}p{color:#b4becb}label{display:block;margin:16px 0 8px}input,select,button{font:inherit;border-radius:10px;padding:12px;width:100%;border:1px solid #475365;background:#10141b;color:inherit}button{margin-top:18px;background:#c94956;border:0;color:white;font-weight:650;cursor:pointer}button:hover{background:#d25a65}button.secondary{background:#303845}a{color:#ec98a1}code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;background:#10141b;padding:16px;border-radius:10px}footer{font-size:12px;color:#8b96a7;margin-top:32px}.notice{border-left:3px solid #dba65a;padding-left:14px}.row{display:flex;gap:16px}.row>*{flex:1}`;

export function loginPage(): string {
  return page('Connexion', '<h1>Ton solde, à portée de regard.</h1><p>Configure la connexion bancaire et tes widgets depuis cet espace privé.</p><section><h2>Administration</h2><form method="post" action="/admin/login"><label for="password">Mot de passe administrateur</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Se connecter</button></form></section>');
}

export function dashboard(connection: Connection | null, csrf: string, configured: boolean, devices: string[]): string {
  const hidden = `<input type="hidden" name="csrf" value="${escapeHTML(csrf)}">`;
  const accounts = connection?.accounts.map(account => `<option value="${escapeHTML(account.uid)}"${account.uid === connection.selectedAccount?.uid ? ' selected' : ''}>${escapeHTML(account.label)}</option>`).join('') ?? '';
  return page('Configuration', `<h1>Configuration des widgets</h1><p>Mac et iPhone consultent la même API privée, indépendamment l’un de l’autre.</p>
    <section><h2>Connexion bancaire</h2><p>${connection ? `Autorisation valable jusqu’au ${escapeHTML(connection.expiresAt)}${connection.needsReauth ? ' · Reconnexion nécessaire' : ''}.` : 'Aucun compte connecté.'}</p>
    ${configured ? '<a href="/admin/banks">Choisir ma caisse et connecter ma banque</a>' : '<p class="notice">Renseigne ENABLE_BANKING_APP_ID et monte la clé privée sur le serveur pour activer la connexion réelle.</p>'}
    ${accounts ? `<form method="post" action="/admin/account">${hidden}<label for="account">Compte courant affiché</label><select id="account" name="account">${accounts}</select><button>Choisir ce compte</button></form>` : ''}
    ${connection ? `<form method="post" action="/admin/disconnect">${hidden}<button class="secondary">Déconnecter la banque et effacer le cache</button></form>` : ''}</section>
    <section><h2>Accès des appareils</h2><p>Un jeton distinct pour chaque appareil. Créer un nouveau jeton remplace immédiatement le précédent de cet appareil.</p>
    <form method="post" action="/admin/devices">${hidden}<label for="slot">Appareil</label><select id="slot" name="slot"><option value="iphone">iPhone</option><option value="mac">Mac</option></select><button>Créer un jeton</button></form>
    ${devices.map(slot => `<form method="post" action="/admin/devices/revoke">${hidden}<input type="hidden" name="slot" value="${slot}"><button class="secondary">Révoquer le jeton ${slot === 'mac' ? 'Mac' : 'iPhone'}</button></form>`).join('')}</section>
    <form method="post" action="/admin/logout">${hidden}<button class="secondary">Se déconnecter de l’administration</button></form>`);
}
