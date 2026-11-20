// Prosty, atomowy zapis JSON w katalogu danych aplikacji.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const dir = () => app.getPath('userData');
const queues = new Map();

function file(name) {
  return path.join(dir(), `${name}.json`);
}

function load(name, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    // spróbuj kopii zapasowej, jeśli główny plik jest uszkodzony
    try {
      return JSON.parse(fs.readFileSync(file(name) + '.bak', 'utf8'));
    } catch {
      return fallback;
    }
  }
}

// Zapisy do tego samego pliku są serializowane, ostatni wygrywa.
function save(name, data) {
  const json = JSON.stringify(data);
  const prev = queues.get(name) || Promise.resolve();
  const next = prev.then(async () => {
    const target = file(name);
    const tmp = target + '.tmp';
    await fs.promises.mkdir(dir(), { recursive: true });
    await fs.promises.writeFile(tmp, json, 'utf8');
    try { await fs.promises.copyFile(target, target + '.bak'); } catch {}
    await fs.promises.rename(tmp, target);
  }).catch((e) => console.error('[store] save failed', name, e));
  queues.set(name, next);
  return next;
}

function saveSync(name, data) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[store] saveSync failed', e);
  }
}

module.exports = { load, save, saveSync };
