/**
 * Office-host steps the setup program runs elevated, and the matching undo.
 *
 *   node prepare-host.cjs
 *   node prepare-host.cjs --restore-power
 *
 * Saving the previous sleep timeouts and creating the backup folder do not
 * start the server. The certificate is written by `leaveos-run.cjs --prepare`.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RECORD = 'power-previous.json';

function parseAcMinutes(text) {
  const match = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(String(text ?? ''));
  if (!match) return null;
  const seconds = Number.parseInt(match[1], 16);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds / 60);
}

function defaultBackupDir(programData) {
  return path.join(programData || 'C:\\ProgramData', 'SimonAndSons', 'LeaveOS', 'backups');
}

function queryAcMinutes(alias) {
  const result = spawnSync('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', alias], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return parseAcMinutes(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

function changeAc(standbyMinutes, hibernateMinutes) {
  spawnSync('powercfg', ['/change', 'standby-timeout-ac', String(standbyMinutes)], {
    encoding: 'utf8',
    windowsHide: true,
  });
  spawnSync('powercfg', ['/change', 'hibernate-timeout-ac', String(hibernateMinutes)], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function recordPath() {
  return path.join(__dirname, RECORD);
}

function ensureBackupDir() {
  const dir = defaultBackupDir(process.env.PROGRAMDATA);
  fs.mkdirSync(dir, { recursive: true });
  const note = path.join(path.dirname(dir), 'backup-directory.txt');
  fs.mkdirSync(path.dirname(note), { recursive: true });
  fs.writeFileSync(note, `${dir}\n`, 'utf8');
  return dir;
}

function captureAndKeepAwake() {
  const file = recordPath();
  if (!fs.existsSync(file)) {
    const standby = queryAcMinutes('STANDBYIDLE');
    const hibernate = queryAcMinutes('HIBERNATEIDLE');
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          standbyAcMinutes: standby,
          hibernateAcMinutes: hibernate,
          captured: standby !== null || hibernate !== null,
        },
        null,
        2,
      ),
    );
  }
  changeAc(0, 0);
  ensureBackupDir();
}

function restorePower() {
  let standby = 30;
  let hibernate = 0;
  const file = recordPath();
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Number.isInteger(saved.standbyAcMinutes)) standby = saved.standbyAcMinutes;
    if (Number.isInteger(saved.hibernateAcMinutes)) hibernate = saved.hibernateAcMinutes;
  }
  changeAc(standby, hibernate);
}

function main() {
  if (process.platform !== 'win32') {
    console.error('Leave OS host preparation runs on Windows.');
    process.exit(1);
  }
  if (process.argv.includes('--restore-power')) {
    restorePower();
    return;
  }
  captureAndKeepAwake();
}

module.exports = { parseAcMinutes, defaultBackupDir };

if (require.main === module) main();
