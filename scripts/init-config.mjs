import { mkdir, writeFile, access, chmod } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const secrets = join(root, 'secrets');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
if (await exists(join(root, '.env'))) {
  process.stderr.write('Configuration existante : aucun fichier remplacé.\n'); process.exitCode = 1;
} else {
  await mkdir(secrets, { recursive: true, mode: 0o700 });
  await chmod(secrets, 0o700);
  // Le dossier privé protège les fichiers sur l'hôte ; les secrets montés sont lisibles par l'utilisateur non-root du conteneur.
  if (!await exists(join(secrets, 'encryption.key'))) await writeFile(join(secrets, 'encryption.key'), randomBytes(32).toString('base64'), { mode: 0o644, flag: 'wx' });
  if (!await exists(join(secrets, 'enable-banking.pem'))) await writeFile(join(secrets, 'enable-banking.pem'), '', { mode: 0o644, flag: 'wx' });
  const password = randomBytes(32).toString('base64url');
  await writeFile(join(secrets, 'admin-password.txt'), password + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(root, '.env'), `NODE_ENV=development\nPUBLIC_URL=http://localhost:3000\nDOMAIN=\nADMIN_PASSWORD_HASH=${createHash('sha256').update(password).digest('hex')}\nENABLE_BANKING_APP_ID=\n`, { mode: 0o600, flag: 'wx' });
  process.stdout.write('Configuration locale créée. Mot de passe dans secrets/admin-password.txt (non affiché).\n');
}
