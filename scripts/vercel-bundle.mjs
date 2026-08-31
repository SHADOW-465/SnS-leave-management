import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
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

const publicIndex = path.resolve('public/index.html');
if (!fs.existsSync(publicIndex)) {
  const src = path.resolve('apps/web/dist');
  if (!fs.existsSync(path.join(src, 'index.html'))) {
    console.error('Build the web app first: pnpm --filter @sns/web exec vite build');
    process.exit(1);
  }
  fs.rmSync('public', { recursive: true, force: true });
  fs.cpSync(src, 'public', { recursive: true });
}

const sqlDir = path.resolve('packages/database/src/sql');
const sql0001 = JSON.stringify(fs.readFileSync(path.join(sqlDir, '0001_init.sql'), 'utf8'));
const sql0002 = JSON.stringify(
  fs.readFileSync(path.join(sqlDir, '0002_holiday_one_kind_per_date.sql'), 'utf8'),
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
            `let sql = m.id === '0001_init' ? ${sql0001} : ${sql0002};`,
          );
          return { contents: src, loader: 'ts' };
        });
      },
    },
  ],
});

const nativeRoot = path.resolve('api/node_modules');
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
