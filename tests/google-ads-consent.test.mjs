import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Offline behavioral tests: no browser, network requests or production events.
const original = await readFile(new URL('../assets/cookie-consent.js', import.meta.url), 'utf8');
const GA = 'G-RB9D1EMFDZ';
const ADS = 'AW-18528448427';
const TEST_LABEL = 'OFFLINE_TEST_ONLY';
const timestamp = () => new Date(Date.now() - 1000).toISOString();
const saved = ({ analytics = false, ads = false, marketing = false, version = '5' } = {}) =>
  [version, 'denied', analytics ? 'granted' : 'denied', marketing ? 'granted' : 'denied', ...(version === '5' ? [ads ? 'granted' : 'denied'] : []), timestamp()].join('|');

function run({ choice, path = '/danke', referrer = '', label = TEST_LABEL, cookies = {} } = {}) {
  const cookieJar = new Map(Object.entries(cookies));
  if (choice) cookieJar.set('pe_cookie_choice', encodeURIComponent(choice));
  const listeners = new Map();
  const scripts = [];
  const elements = new Map();
  const formFields = new Map([
    ['[name="name"]', { value: 'PRIVATE_NAME' }],
    ['[name="email"]', { value: 'private@example.invalid' }],
    ['[name="lead_id"]', { value: '' }],
    ['[name="erstkontakt_zeitpunkt"]', { value: '' }],
    ['[name="cookie_einwilligung"]', { value: '' }],
    ['[name="vorgangs_id"]', { value: 'PRIVATE_REQUEST_ID' }],
  ]);
  function element(tag) {
    const handlers = new Map();
    const children = new Map();
    return {
      tagName: tag.toUpperCase(), hidden: false, checked: false,
      setAttribute() {}, focus() {},
      addEventListener(type, fn) { handlers.set(type, fn); },
      dispatch(type) { handlers.get(type)?.(); },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element('input'));
        return children.get(selector);
      },
      appendChild(child) {
        child.parentNode = this;
        if (child.id) elements.set(child.id, child);
        if (child.tagName === 'SCRIPT') scripts.push(child);
      },
      insertBefore(child) { this.appendChild(child); },
    };
  }
  const document = {
    head: element('head'), body: element('body'), referrer,
    createElement: element,
    getElementById(id) { return id === 'konfForm' ? { querySelector: s => formFields.get(s) || null } : elements.get(id) || null; },
    getElementsByTagName(tag) { return tag === 'script' ? scripts : []; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchEvent() {},
    get cookie() { return [...cookieJar].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(value) {
      const [assignment, ...attrs] = value.split(';');
      const separator = assignment.indexOf('=');
      const name = assignment.slice(0, separator);
      if (attrs.some(attr => attr.trim() === 'Max-Age=0')) cookieJar.delete(name);
      else cookieJar.set(name, assignment.slice(separator + 1));
    },
  };
  const window = { location: new URL(path, 'https://paschenenergie.de'), crypto: webcrypto };
  const context = vm.createContext({ window, document, URL, Uint8Array, Date, Math, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } } });
  const source = label === null ? original : original.replace(/const ADS_CONVERSION_LABEL = '[^']*';/, `const ADS_CONVERSION_LABEL = '${label}';`);
  vm.runInContext(source, context, { timeout: 1000 });
  return {
    window, document, scripts, cookieJar, formFields,
    commands: () => Array.from(window.dataLayer || [], args => Array.from(args)),
    conversions: () => Array.from(window.dataLayer || []).filter(args => args[0] === 'event' && args[1] === 'conversion'),
    configs: () => Array.from(window.dataLayer || []).filter(args => args[0] === 'config'),
    loadGoogle() {
      const loader = scripts.find(s => s.id === 'pe-google-tag');
      assert.ok(loader, 'Google library should have been requested');
      loader.dispatch('load');
    },
    select({ analytics = false, ads = false, marketing = false, lead = false } = {}) {
      const banner = elements.get('pe-cookie-banner');
      for (const [key, value] of Object.entries({ analytics, ads, marketing, lead })) banner.querySelector(`#pe-consent-${key}`).checked = value;
      const button = { getAttribute: () => 'selected' };
      listeners.get('click')({ target: { closest: selector => selector === '[data-pe-cookie]' ? button : null } });
    },
  };
}

test('no consent or rejected consent creates no Google/Meta library or conversion', () => {
  for (const choice of [undefined, saved()]) {
    const h = run({ choice });
    assert.equal(h.scripts.length, 0);
    assert.equal(h.commands().length, 0);
    assert.equal(h.conversions().length, 0);
  }
});

test('analytics-only consent never configures an Ads destination or conversion', () => {
  const h = run({ choice: saved({ analytics: true }) });
  assert.equal(h.scripts.length, 1);
  assert.ok(h.scripts[0].src.endsWith(GA));
  h.loadGoogle();
  assert.deepEqual(h.configs().map(c => c[1]), [GA]);
  assert.equal(h.conversions().length, 0);
  const update = h.commands().filter(c => c[0] === 'consent' && c[1] === 'update').at(-1)[2];
  assert.equal(update.ad_storage, 'denied');
  assert.equal(update.ad_user_data, 'denied');
});

test('Ads-only consent loads one library and sends the exact conversion destination', () => {
  const h = run({ choice: saved({ ads: true }) });
  assert.equal(h.scripts.length, 1);
  assert.ok(h.scripts[0].src.endsWith(ADS));
  assert.equal(h.configs().length, 0, 'No config is queued before load-time consent check');
  h.loadGoogle();
  assert.deepEqual(h.configs().map(c => c[1]), [ADS]);
  assert.equal(h.conversions().length, 1);
  assert.equal(h.conversions()[0][2].send_to, `${ADS}/${TEST_LABEL}`);
  assert.equal(h.window[`ga-disable-${GA}`], true);
  const update = h.commands().filter(c => c[0] === 'consent' && c[1] === 'update').at(-1)[2];
  assert.equal(update.analytics_storage, 'denied');
  assert.equal(update.ad_storage, 'granted');
  assert.equal(update.ad_user_data, 'granted');
  assert.equal(update.ad_personalization, 'denied');
});

test('v4 consent keeps existing choices but never infers Ads consent', () => {
  const h = run({ choice: saved({ version: '4', analytics: true, marketing: true }) });
  const current = h.window.PaschenCookieConsent.getChoice();
  assert.equal(current.analytics, true);
  assert.equal(current.marketing, true);
  assert.equal(current.ads, false);
  assert.equal(current.needsUpdate, true);
  assert.equal(h.document.getElementById('pe-cookie-banner').hidden, false);
  assert.equal(h.document.getElementById('pe-cookie-banner').querySelector('#pe-consent-ads').checked, false);
  h.loadGoogle();
  assert.deepEqual(h.configs().map(c => c[1]), [GA]);
  assert.equal(h.conversions().length, 0);
});

test('conversion is restricted to exact thank-you routes', () => {
  for (const path of ['/danke', '/danke/', '/danke.html', '/danke.html/']) {
    const h = run({ path, choice: saved({ ads: true }) });
    h.loadGoogle();
    assert.equal(h.conversions().length, 1, path);
  }
  for (const path of ['/', '/mobil.html', '/news', '/news/danke', '/danke-foo', '/danke/extra', '/DANKE']) {
    const h = run({ path, choice: saved({ ads: true }) });
    h.loadGoogle();
    assert.equal(h.conversions().length, 0, path);
  }
});

test('consent on the thank-you page triggers once even after repeated changes', () => {
  const h = run();
  h.select({ ads: true });
  h.loadGoogle();
  h.select({ ads: true, analytics: true });
  h.select();
  h.select({ ads: true });
  assert.equal(h.scripts.length, 1);
  assert.equal(h.conversions().length, 1);
  assert.equal(h.configs().filter(c => c[1] === ADS).length, 1);
});

test('withdrawal during loading prevents configs and conversion', () => {
  const h = run({ choice: saved({ ads: true }) });
  h.select();
  h.loadGoogle();
  assert.equal(h.configs().length, 0);
  assert.equal(h.conversions().length, 0);
  h.select({ ads: true });
  assert.equal(h.conversions().length, 1);
  assert.equal(h.scripts.length, 1);
});

test('Ads config keeps attribution IDs but removes other query values and fragment', () => {
  const h = run({ choice: saved({ ads: true, analytics: true }), path: '/danke?gclid=GCLID_TEST&gbraid=BRAID_TEST&wbraid=WBRAID_TEST&email=private%40example.invalid&name=PRIVATE_NAME#PRIVATE_FRAGMENT', referrer: 'https://example.invalid/start?email=private%40example.invalid#PRIVATE_FRAGMENT' });
  h.loadGoogle();
  const ads = h.configs().find(c => c[1] === ADS)[2];
  const ga = h.configs().find(c => c[1] === GA)[2];
  assert.equal(ads.page_location, 'https://paschenenergie.de/danke?gclid=GCLID_TEST&gbraid=BRAID_TEST&wbraid=WBRAID_TEST');
  assert.equal(ga.page_location, 'https://paschenenergie.de/danke');
  assert.equal(ads.page_referrer, 'https://example.invalid/start');
  assert.equal(h.conversions()[0][2].page_location, 'https://paschenenergie.de/danke');
  assert.equal(ads.allow_enhanced_conversions, false);
  assert.doesNotMatch(JSON.stringify(h.commands()), /PRIVATE_|private@example/);
});

test('withdrawal removes first-party Ads attribution cookies', () => {
  const h = run({ choice: saved({ ads: true }), cookies: { _gcl_aw: 'a', _gcl_au: 'b', _gcl_gs: 'c', required: 'keep' } });
  h.loadGoogle();
  h.select();
  assert.equal(h.cookieJar.has('_gcl_aw'), false);
  assert.equal(h.cookieJar.has('_gcl_au'), false);
  assert.equal(h.cookieJar.has('_gcl_gs'), false);
  assert.equal(h.cookieJar.get('required'), 'keep');
});

test('production configuration sends the user-confirmed conversion label', () => {
  const h = run({ label: null, choice: saved({ ads: true }) });
  h.loadGoogle();
  assert.equal(h.conversions().length, 1);
  assert.equal(h.conversions()[0][2].send_to, 'AW-18528448427/Oo2-CN76uaUdEKvfhoNF');
});

test('missing label cannot emit a manual conversion', () => {
  const h = run({ label: '', choice: saved({ ads: true }) });
  h.loadGoogle();
  assert.equal(h.configs().length, 1);
  assert.equal(h.conversions().length, 0);
});

test('default consent precedes product configuration and events', () => {
  const h = run({ choice: saved({ analytics: true, ads: true }) });
  h.loadGoogle();
  const commands = h.commands();
  assert.equal(commands[0][0], 'consent');
  assert.equal(commands[0][1], 'default');
  assert.deepEqual(Object.values(commands[0][2]), ['denied', 'denied', 'denied', 'denied']);
  assert.ok(commands.findIndex(c => c[0] === 'config') > commands.findIndex(c => c[0] === 'consent' && c[1] === 'update'));
});

test('form consent record includes separate Google Ads status without forwarding form contents', () => {
  const h = run();
  h.select({ ads: true });
  h.loadGoogle();
  assert.match(h.formFields.get('[name="cookie_einwilligung"]').value, /Google Ads: erteilt/);
  assert.doesNotMatch(JSON.stringify(h.commands()), /PRIVATE_NAME|PRIVATE_REQUEST_ID|private@example/);
  h.select();
  assert.match(h.formFields.get('[name="cookie_einwilligung"]').value, /Google Ads: abgelehnt/);
});
