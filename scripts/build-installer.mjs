/**
 * Builds the office host and wraps it in a Windows setup program.
 *
 *   node scripts/build-installer.mjs
 *
 * Requires Inno Setup 6 (ISCC.exe). If it is not installed the script stops before
 * the long build and tells you where to get it.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const payload = path.join(repoRoot, 'dist', 'installer', 'payload');
const cache = path.join(repoRoot, 'installer', 'cache');

const ISCC_CANDIDATES = [
  process.env.ISCC,
  path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.ProgramFiles ?? '', 'Inno Setup 6', 'ISCC.exe'),
  path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean);

function findIscc() {
  const onPath = spawnSync('where.exe', ['iscc'], { encoding: 'utf8' });
  if (onPath.status === 0) {
    const line = onPath.stdout.split(/\r?\n/).find((l) => l.trim());
    if (line) return line.trim();
  }
  return ISCC_CANDIDATES.find((p) => p && fs.existsSync(p)) ?? null;
}

function failIscc() {
  console.error(
    [
      '',
      'Inno Setup compiler (iscc) was not found, so the setup program was not built.',
      '',
      'Install Inno Setup 6, which provides ISCC.exe:',
      '  https://jrsoftware.org/isdl.php',
      '',
      'The default locations this script checks are:',
      '  C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
      '  C:\\Program Files\\Inno Setup 6\\ISCC.exe',
      '  %LOCALAPPDATA%\\Programs\\Inno Setup 6\\ISCC.exe',
      '',
      'You can also add ISCC.exe to PATH, or set the ISCC environment variable to the full path.',
      'Then run:  node scripts/build-installer.mjs',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const iscc = findIscc();
if (!iscc) failIscc();

console.log(`Using Inno Setup: ${iscc}`);
run('pnpm', ['--filter', '@sns/web', 'build']);

fs.rmSync(payload, { recursive: true, force: true });
fs.mkdirSync(payload, { recursive: true });
fs.cpSync(path.join(repoRoot, 'apps', 'web', 'dist'), path.join(payload, 'web'), {
  recursive: true,
});

const sqlDir = path.join(repoRoot, 'packages', 'database', 'src', 'sql');
const migrationSql = Object.fromEntries(
  fs
    .readdirSync(sqlDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => [name.replace(/\.sql$/, ''), fs.readFileSync(path.join(sqlDir, name), 'utf8')]),
);

const esbuild = createRequire(path.join(repoRoot, 'package.json'))('esbuild');
await esbuild.build({
  absWorkingDir: repoRoot,
  entryPoints: ['apps/server/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: path.join(payload, 'server.mjs'),
  // CJS deps (fastify, avvio) call require() on node builtins; ESM output has no require.
  banner: {
    js: "import { createRequire as __leaveosCreateRequire } from 'node:module';\nconst require = __leaveosCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
  plugins: [
    {
      name: 'argon2-external',
      setup(build) {
        build.onResolve({ filter: /^@node-rs\/argon2$/ }, () => ({
          path: '@node-rs/argon2',
          external: true,
        }));
      },
    },
    {
      name: 'inline-sql',
      setup(build) {
        build.onLoad({ filter: /[\\/]open\.ts$/ }, async (args) => {
          let src = await fs.promises.readFile(args.path, 'utf8');
          src = src.replace(
            /let sql = fs\.readFileSync\(new URL\(`\.\/sql\/\$\{m\.id\}\.sql`, import\.meta\.url\), 'utf8'\);/,
            `let sql = (${JSON.stringify(migrationSql)})[m.id];`,
          );
          return { contents: src, loader: 'ts' };
        });
      },
    },
  ],
});

copyArgon(path.join(payload, 'node_modules'));
for (const file of ['install-service.cjs', 'leaveos-run.cjs', 'prepare-host.cjs', 'Leave OS.url']) {
  fs.copyFileSync(path.join(repoRoot, 'installer', file), path.join(payload, file));
}
await copyNodeExe(path.join(payload, 'node.exe'));

const compiled = spawnSync(iscc, [path.join(repoRoot, 'installer', 'leaveos.iss')], {
  cwd: repoRoot,
  encoding: 'utf8',
});
process.stdout.write(compiled.stdout ?? '');
process.stderr.write(compiled.stderr ?? '');
if (compiled.status !== 0) process.exit(compiled.status ?? 1);

const exe = path.join(repoRoot, 'dist', 'installer', 'LeaveOS-Setup.exe');
if (!fs.existsSync(exe)) {
  console.error(`ISCC finished but ${exe} is missing.`);
  process.exit(1);
}
console.log(`Setup program: ${exe}`);

function copyArgon(nativeRoot) {
  const require = createRequire(path.join(repoRoot, 'apps', 'server', 'package.json'));
  const pkgJson = require.resolve('@node-rs/argon2/package.json');
  const src = path.dirname(pkgJson);
  const dest = path.join(nativeRoot, '@node-rs', 'argon2');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return;
  const nested = path.join(dest, 'node_modules', '@node-rs');
  for (const dir of fs.readdirSync(pnpmDir)) {
    if (!dir.startsWith('@node-rs+argon2')) continue;
    const innerNs = path.join(pnpmDir, dir, 'node_modules', '@node-rs');
    if (!fs.existsSync(innerNs)) continue;
    for (const pkg of fs.readdirSync(innerNs)) {
      const from = path.join(innerNs, pkg);
      const target = path.join(nativeRoot, '@node-rs', pkg);
      if (!fs.existsSync(target)) fs.cpSync(from, target, { recursive: true, dereference: true });
      fs.mkdirSync(nested, { recursive: true });
      const nestedTarget = path.join(nested, pkg);
      if (!fs.existsSync(nestedTarget)) {
        fs.cpSync(from, nestedTarget, { recursive: true, dereference: true });
      }
    }
  }
}

async function copyNodeExe(dest) {
  const version = process.version.replace(/^v/, '');
  const zipName = `node-v${version}-win-x64.zip`;
  const zipPath = path.join(cache, zipName);
  fs.mkdirSync(cache, { recursive: true });
  if (!fs.existsSync(zipPath)) {
    const url = `https://nodejs.org/dist/v${version}/${zipName}`;
    console.log(`Downloading portable Node ${version}…`);
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      console.warn(
        `Could not download ${url} (${res.status}). Copying the Node that is running this script.`,
      );
      fs.copyFileSync(process.execPath, dest);
      return;
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath));
  }
  const extract = path.join(cache, `node-v${version}-win-x64`);
  if (!fs.existsSync(path.join(extract, 'node.exe'))) {
    const unpacked = spawnSync('tar', ['-xf', zipPath, '-C', cache], { encoding: 'utf8' });
    if (unpacked.status !== 0 || !fs.existsSync(path.join(extract, 'node.exe'))) {
      console.warn('Could not unpack the Node zip. Copying the Node that is running this script.');
      fs.copyFileSync(process.execPath, dest);
      return;
    }
  }
  fs.copyFileSync(path.join(extract, 'node.exe'), dest);
}
