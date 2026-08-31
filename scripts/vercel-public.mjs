import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('apps/web/dist');
const dest = path.resolve('public');
if (fs.existsSync(path.join(dest, 'index.html'))) {
  process.exit(0);
}
if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('apps/web/dist/index.html is missing. Build @sns/web first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
