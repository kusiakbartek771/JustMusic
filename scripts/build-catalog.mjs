// Generuje store/catalog.json – katalog sklepu z pluginami pobierany przez aplikację z GitHuba.
// Uruchom po każdej zmianie pluginu:  npm run catalog
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'store');

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out.sort();
}

const plugins = [];
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  const dir = path.join(root, e.name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (m.id !== e.name) throw new Error(`Folder „${e.name}” musi mieć taką samą nazwę jak id pluginu („${m.id}”)`);
  plugins.push({ ...m, files: listFiles(dir) });
}
plugins.sort((a, b) => a.id.localeCompare(b.id));

const catalog = { version: 1, plugins };
fs.writeFileSync(path.join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
console.log(`store/catalog.json: ${plugins.length} pluginów (${plugins.map((p) => `${p.id}@${p.version}`).join(', ')})`);
