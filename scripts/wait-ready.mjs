import { setTimeout } from 'node:timers/promises';
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  try {
    if ((await fetch('http://localhost:3000/ready', { signal: AbortSignal.timeout(2000) })).ok) {
      process.stdout.write('API et Redis disponibles.\n'); process.exit(0);
    }
  } catch { /* Attendre la reprise du conteneur ou de la connexion Redis. */ }
  await setTimeout(500);
}
process.stderr.write('API indisponible après 30 secondes.\n'); process.exitCode = 1;
