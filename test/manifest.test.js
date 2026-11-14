// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code (countries, account fields, action), so a key renamed on one
// side only fails here. No version is pinned: only its shape and its agreement
// across files. When the Gladys clone is on the machine, the core's own
// manifest validation runs on it too.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIONS, COUNTRIES, USER_AGENT, VERSION } from '../src/constants.js';
import { TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');
const field = (list, key) => list.find((f) => f.key === key);

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'calendar');
  assert.equal(manifest.gladys_version, '>=5.3.0', 'countries need 5.3.0 (calendar 5.2.0)');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-vacances-scolaires-europe');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(VERSION, pkg.version, 'the User-Agent carries the version');
  assert.ok(USER_AGENT.includes(`/${pkg.version} `));
  assert.equal(
    manifest.docker_image,
    `ghcr.io/lm1lc3n7/gladys-vacances-scolaires-europe:${manifest.version}`,
  );
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-vacances-scolaires-europe\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['services']);
  assert.equal(manifest.keywords, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(docs, /OpenHolidays/);
    assert.match(docs, /ODbL/);
  }
});

test('countries: 1 to 20 upper-case ISO codes, offered by the code, never France', () => {
  const codes = manifest.countries;
  assert.ok(codes.length >= 1 && codes.length <= 20);
  assert.equal(new Set(codes).size, codes.length);
  const offered = new Set(COUNTRIES.map((c) => c.code));
  for (const code of codes) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.ok(offered.has(code), code);
  }
  assert.ok(!offered.has('FR'), 'France stays with gladys-holidays');
  assert.ok(!codes.includes('FR'));
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  const sections = [...manifest.config_schema, ...manifest.account_schema].filter(
    (f) => f.type === 'section',
  );
  for (const section of sections) {
    for (const lang of ['en', 'fr']) assert.ok(section.description[lang].length <= 1000);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('no key starts with gladys_; no secret at all; nothing said encrypted', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.account_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
  ];
  for (const f of fields) {
    assert.doesNotMatch(f.key, /^gladys_/);
    assert.notEqual(f.type, 'secret');
  }
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffré|chiffrement|encrypt|hachage/i, file);
  }
});

test('the account fields: the country among those offered, the regions free text', () => {
  const country = field(manifest.account_schema, 'country');
  assert.equal(country.type, 'select');
  assert.equal(country.required, true);
  assert.equal(country.default, undefined);
  assert.deepEqual(
    country.options.map((o) => [o.value, o.label.en, o.label.fr]),
    COUNTRIES.map((c) => [c.code, c.en, c.fr]),
  );
  const regions = field(manifest.account_schema, 'regions');
  assert.equal(regions.type, 'string');
  assert.ok(!regions.required);
  const code = read('src/app.js');
  assert.ok(code.includes('config.country') && code.includes('config.regions'));
  // Every select option: a non-empty string value, unique, a label in both languages.
  const selects = [country, ...manifest.actions.flatMap((a) => a.fields ?? [])].filter(
    (f) => f.type === 'select',
  );
  for (const s of selects) {
    const values = s.options.map((o) => o.value);
    assert.equal(new Set(values).size, values.length);
    for (const o of s.options) {
      assert.deepEqual(Object.keys(o).sort(), ['label', 'value']);
      assert.equal(typeof o.value, 'string');
      assert.ok(o.value.length > 0);
      for (const lang of ['en', 'fr']) {
        assert.equal(o.label[lang].trim(), o.label[lang]);
        assert.ok(o.label[lang].length > 0);
      }
    }
  }
  // No admin setting: everything is per user.
  assert.deepEqual(
    manifest.config_schema.filter((f) => f.type !== 'section'),
    [],
  );
});

test('the action is the one the code handles; no device, nothing commanded', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(handlers.includes('onAction(ACTIONS.LIST_REGIONS'));
  assert.ok(handlers.includes('onCalendarAccountUpdated'));
  for (const a of manifest.actions) assert.ok(a.timeout_seconds >= 45 && a.timeout_seconds <= 120);
  assert.deepEqual(
    field(manifest.actions[0].fields, 'country').options,
    field(manifest.account_schema, 'country').options,
  );
  assert.ok(!handlers.includes('onSetValue'));
  assert.ok(!handlers.includes('publishDiscoveredDevices'));
});

test('the core accepts the manifest (its own validation, when the clone is here)', (t) => {
  const path = `${CORE}/lib/external-integration/externalIntegration.validateManifest.js`;
  if (!existsSync(path)) {
    t.skip('no Gladys clone');
    return;
  }
  // In a child process with its own directory: loading the core opens a
  // DuckDB file in the current directory.
  const dir = mkdtempSync(join(tmpdir(), 'vse-core-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const manifestPath = fileURLToPath(
    new URL('../gladys-assistant-integration.json', import.meta.url),
  );
  const script = `const { validateManifest } = require(${JSON.stringify(path)});
    validateManifest(require(${JSON.stringify(manifestPath)})); console.log('VALID');`;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.match(out, /VALID/);
});

test('every runtime text exists in both languages, same placeholders', () => {
  for (const [key, entry] of Object.entries(TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
