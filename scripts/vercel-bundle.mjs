import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function copyPackage(name, destRoot) {
  let pkgJson;
  try {
    pkgJson = require.resolve(`${name}/package.json`);
  } catch {
    return false;
  }
  const src = path.dirname(pkgJson);
  const dest = path.join(destRoot, ...name.split('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

const webDir = path.resolve('apps/web');
const vite = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vite.status !== 0) {
  process.exit(vite.status ?? 1);
}

const src = path.resolve('apps/web/dist');
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('Vite build did not produce apps/web/dist/index.html');
  process.exit(1);
}
fs.rmSync('public', { recursive: true, force: true });
fs.cpSync(src, 'public', { recursive: true });

const sqlDir = path.resolve('packages/database/src/sql');
// Every migration file, inlined by id. Read from the folder rather than listed by hand, so
// adding a migration cannot silently leave the hosted build on an older schema.
const migrationSql = Object.fromEntries(
  fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => [f.replace(/\.sql$/, ''), fs.readFileSync(path.join(sqlDir, f), 'utf8')]),
);

fs.mkdirSync('api', { recursive: true });

await esbuild.build({
  absWorkingDir: process.cwd(),
  entryPoints: ['apps/server/src/vercel-handler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outfile: 'api/index.js',
  external: [],
  logLevel: 'info',
  plugins: [
    {
      name: 'argon2-relative',
      setup(build) {
        build.onResolve({ filter: /^@node-rs\/argon2$/ }, () => ({
          path: './node_modules/@node-rs/argon2/index.js',
          external: true,
        }));
        // CJS bundle lives next to api/node_modules.
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

const nativeRoot = path.resolve('api/node_modules');
if (fs.existsSync(nativeRoot)) {
  fs.rmSync(nativeRoot, { recursive: true, force: true });
}
if (!copyPackage('@node-rs/argon2', nativeRoot)) {
  console.error('Failed to copy @node-rs/argon2 into api/node_modules');
  process.exit(1);
}
const pnpmDir = path.resolve('node_modules/.pnpm');
if (fs.existsSync(pnpmDir)) {
  const nested = path.join(nativeRoot, '@node-rs', 'argon2', 'node_modules');
  for (const dir of fs.readdirSync(pnpmDir)) {
    if (!dir.startsWith('@node-rs+argon2')) continue;
    const inner = path.join(pnpmDir, dir, 'node_modules');
    if (!fs.existsSync(inner)) continue;
    const innerNs = path.join(inner, '@node-rs');
    if (fs.existsSync(innerNs)) {
      for (const pkg of fs.readdirSync(innerNs)) {
        if (fs.existsSync(path.join(nativeRoot, '@node-rs', pkg))) continue;
        const from = path.join(innerNs, pkg);
        const opts = { recursive: true, force: true, dereference: true };
        fs.cpSync(from, path.join(nativeRoot, '@node-rs', pkg), opts);
        fs.mkdirSync(path.join(nested, '@node-rs'), { recursive: true });
        fs.cpSync(from, path.join(nested, '@node-rs', pkg), opts);
        console.warn(`copied native addon @node-rs/${pkg}`);
      }
    }
  }
}
