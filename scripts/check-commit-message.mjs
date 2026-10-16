import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

let subjects;
if (process.argv[2] === '--history') {
  subjects = execFileSync('git', ['log', '--format=%s', process.argv[3] ?? 'HEAD'], { encoding: 'utf8' }).trimEnd().split('\n');
} else if (process.argv[2]) {
  subjects = [readFileSync(process.argv[2], 'utf8').split(/\r?\n/)[0]];
} else {
  process.stderr.write('Usage : node scripts/check-commit-message.mjs <fichier> ou --history <révision>\n');
  process.exit(1);
}
if (subjects.some(subject => !/^feat: \S.*$/.test(subject))) {
  process.stderr.write('Commit refusé : utiliser « feat: description » sans scope, avec une description en français.\n');
  process.exitCode = 1;
}
