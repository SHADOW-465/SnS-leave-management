import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const names = [
  'setupStatus',
  'currentUserView',
  'myHome',
  'dashboard',
  'leaveTypes',
  'previewLeave',
  'listRequests',
  'requestDetail',
  'ledger',
  'listEmployees',
  'calendarMonth',
  'availability',
  'reports',
  'auditLog',
  'notifications',
  'policies',
  'queue',
  'graphFor',
  'currentPeriodId',
  'integrityCheck',
  'backupTo',
  'logout',
  'grantOpeningBalances',
  'authorizeAction',
];
const nameRe = new RegExp(`(?<!await )(?<!function )\\b(${names.join('|')})\\(`, 'g');

for (const f of walk(path.join('apps', 'server', 'src'))) {
  let s = fs.readFileSync(f, 'utf8');
  const orig = s;
  s = s.replace(nameRe, 'await $1(');
  s = s.replace(/await await /g, 'await ');
  if (s !== orig) {
    fs.writeFileSync(f, s);
    console.log('patched', f);
  }
}
