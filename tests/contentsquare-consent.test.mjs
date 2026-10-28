import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

// Offline integration-boundary tests. No browser, SDK execution, network or real analytics events.
const source = await readFile(new URL('../assets/cookie-consent.js', import.meta.url), 'utf8');
const TAG = 'https://t.contentsquare.net/uxa/8aa1363a40e89.js';
const purposes = ['lead', 'analytics', 'marketing', 'ads', 'contentsquare'];
const iso = () => new Date(Date.now() - 1000).toISOString();
const choice = (selected = {}, version = '7', at = iso()) =>
  [version, ...purposes.slice(0, version === '6' ? 4 : 5).map(key => selected[key] ? 'granted' : 'denied'), at].join('|');
const plain = value => JSON.parse(JSON.stringify(value));

function harness({ saved, cookies = {}, path = '/?email=PRIVATE_EMAIL#PRIVATE_FRAGMENT' } = {}) {
  const jar = new Map(Object.entries(cookies));
  if (saved) jar.set('pe_cookie_choice', encodeURIComponent(saved));
  const listeners = new Map();
  const elements = new Map();
  const scripts = [];
  const events = [];
  let reloads = 0;
  const fields = new Map([
    ['[name="name"]', { value: 'PRIVATE_FORM_VALUE' }],
    ['[name="lead_id"]', { value: '' }],
    ['[name="erstkontakt_zeitpunkt"]', { value: '' }],
    ['[name="cookie_einwilligung"]', { value: '' }],
    ['[name="vorgangs_id"]', { value: 'PRIVATE_REQUEST_ID' }],
  ]);
  function element(tag) {
    const handlers = new Map();
    const children = new Map();
    const attributes = new Map();
    return {
      tagName: tag.toUpperCase(), hidden: false, checked: false,
      setAttribute(key, value) { attributes.set(key, String(value)); },
      getAttribute(key) { return attributes.get(key) ?? null; },
      addEventListener(type, fn) { handlers.set(type, fn); },
      dispatch(type) { handlers.get(type)?.(); },
      focus() {},
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element('input'));
        return children.get(selector);
      },
      appendChild(child) {
        child.parentNode = this;
        if (child.id) elements.set(child.id, child);
        if (child.tagName === 'SCRIPT') {
          child.commandsAtInsertion = plain(window._uxa || []);
          scripts.push(child);
        }
        return child;
      },
      insertBefore(child) { return this.appendChild(child); },
      remove() { if (this.id) elements.delete(this.id); },
    };
  }
  const document = {
    head: element('head'), body: element('body'),
    referrer: 'https://example.invalid/?email=PRIVATE_REFERRER',
    createElement: element,
    getElementById(id) { return id === 'konfForm' ? { querySelector: key => fields.get(key) || null } : elements.get(id) || null; },
    getElementsByTagName(tag) { return tag === 'script' ? scripts : []; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchEvent(event) { events.push(event); },
    get cookie() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(value) {
      const [assignment, ...attributes] = value.split(';');
      const separator = assignment.indexOf('=');
      const key = assignment.slice(0, separator);
      if (attributes.some(attribute => attribute.trim() === 'Max-Age=0')) jar.delete(key);
      else jar.set(key, assignment.slice(separator + 1));
    },
  };
  const location = new URL(path, 'https://paschenenergie.de');
  location.reload = () => { reloads++; };
  const window = { location, crypto: webcrypto };
  const context = vm.createContext({ window, document, URL, Date, Math, Uint8Array,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  });
  vm.runInContext(source, context, { timeout: 1000 });
  function decide(status, selected = {}) {
    const banner = elements.get('pe-cookie-banner');
    for (const purpose of purposes) banner.querySelector(`#pe-consent-${purpose}`).checked = !!selected[purpose];
    const button = { getAttribute: () => status };
    listeners.get('click')({ target: { closest: selector => selector === '[data-pe-cookie]' ? button : null } });
  }
  return {
    window, document, jar, fields, scripts, events,
    select: selected => decide('selected', selected),
    reject: () => decide('denied'),
    grantAll: () => decide('granted'),
    banner: () => elements.get('pe-cookie-banner'),
    current: () => window.PaschenCookieConsent.getChoice(),
    csScripts: () => scripts.filter(script => script.id === 'pe-contentsquare-tag'),
    csCommands: () => plain(window._uxa || []),
    googleCommands: () => Array.from(window.dataLayer || [], args => Array.from(args)),
    load(id) {
      const script = scripts.find(item => item.id === id);
      assert.ok(script, `${id} must have been requested`);
      script.dispatch('load');
    },
    reloadCount: () => reloads,
  };
}

test('Contentsquare has a separate, initially unchecked consent and does not load before opt-in', () => {
  for (const saved of [undefined, choice(), choice({ analytics: true }), choice({ ads: true })]) {
    const h = harness({ saved });
    assert.equal(h.csScripts().length, 0);
    assert.match(h.banner().innerHTML, /id="pe-consent-contentsquare"/);
    assert.equal(h.banner().querySelector('#pe-consent-contentsquare').checked, false);
    h.reject();
    assert.equal(h.csScripts().length, 0);
    assert.equal(h.current().contentsquare, false);
  }
});

test('version 6 preserves prior Google/Meta choices but cannot grant Contentsquare consent', () => {
  const h = harness({ saved: choice({ lead: true, analytics: true, marketing: true, ads: true }, '6') });
  const current = h.current();
  for (const purpose of purposes.slice(0, 4)) assert.equal(current[purpose], true, purpose);
  assert.equal(current.contentsquare, false);
  assert.equal(current.needsUpdate, true);
  assert.equal(h.banner().hidden, false);
  assert.equal(h.csScripts().length, 0);
  h.load('pe-google-tag');
  const configs = h.googleCommands().filter(command => command[0] === 'config').map(command => command[1]);
  assert.deepEqual(configs, ['G-RB9D1EMFDZ', 'AW-18528448427']);
});

test('Contentsquare-only consent requests the exact tag once and buffers privacy commands first', () => {
  const h = harness();
  h.select({ contentsquare: true });
  h.select({ contentsquare: true });
  assert.equal(h.csScripts().length, 1);
  assert.equal(h.scripts.length, 1, 'Contentsquare consent must not start Google or Meta');
  const script = h.csScripts()[0];
  assert.equal(script.src, TAG);
  assert.equal(script.async, true);
  const commands = script.commandsAtInsertion;
  for (const name of ['setPIISelectors', 'setPath', 'setQuery', 'referrer:removeQueryString']) {
    assert.ok(commands.some(command => command[0] === name), `${name} is queued before external script insertion`);
  }
  assert.equal(commands.find(command => command[0] === 'setPath')[1], '/');
  assert.equal(commands.find(command => command[0] === 'setQuery')[1], '');
  assert.ok(JSON.stringify(commands.find(command => command[0] === 'setPIISelectors')).includes('#k-sum'));
  assert.doesNotMatch(JSON.stringify(commands), /PRIVATE_/);
  assert.equal(h.current().contentsquare, true);
  assert.equal(h.current().version, '7');
  assert.match(h.fields.get('[name="cookie_einwilligung"]').value, /Contentsquare: erteilt/);
});

test('a valid version 7 Contentsquare choice loads on a later page but does not open the banner', () => {
  const h = harness({ saved: choice({ contentsquare: true }), path: '/news' });
  assert.equal(h.current().needsUpdate, false);
  assert.equal(h.csScripts().length, 1);
  assert.equal(h.banner().hidden, true);
  assert.equal(h.csScripts()[0].commandsAtInsertion.find(command => command[0] === 'setPath')[1], '/news');
});

test('an existing Contentsquare opt-out overrides saved consent until a fresh explicit choice', () => {
  const h = harness({ saved: choice({ contentsquare: true }), cookies: { _cs_optout: '1' } });
  assert.equal(h.csScripts().length, 0, 'Saved consent must not silently undo an external opt-out');
  assert.equal(h.jar.get('_cs_optout'), '1');
  h.select({ contentsquare: true });
  assert.equal(h.jar.has('_cs_optout'), false);
  assert.equal(h.csScripts().length, 1);
});

test('expired, malformed or future-dated choices do not load Contentsquare', () => {
  for (const saved of [
    choice({ contentsquare: true }, '7', new Date(Date.now() - 181 * 86400000).toISOString()),
    choice({ contentsquare: true }, '7', new Date(Date.now() + 86400000).toISOString()),
    choice({ contentsquare: true }).replace('|granted|', '|invalid|'),
  ]) {
    const h = harness({ saved });
    assert.equal(h.current(), null);
    assert.equal(h.csScripts().length, 0);
    assert.equal(h.banner().hidden, false);
  }
});

test('withdrawal stops Contentsquare and removes its measurement cookies without deleting unrelated cookies', () => {
  const h = harness({ saved: choice({ contentsquare: true }) });
  h.load('pe-contentsquare-tag');
  for (const [key, value] of Object.entries({ _cs_id: 'visitor', _cs_s: 'session', _cs_c: 'consent', _cs_optout: '1', required: 'keep' })) h.jar.set(key, value);
  h.reject();
  assert.equal(h.current().contentsquare, false);
  assert.ok(h.csCommands().some(command => command[0] === 'optout'));
  for (const name of ['_cs_id', '_cs_s', '_cs_c']) assert.equal(h.jar.has(name), false, name);
  assert.equal(h.jar.get('_cs_optout'), '1');
  assert.equal(h.jar.get('required'), 'keep');
  assert.match(h.fields.get('[name="cookie_einwilligung"]').value, /Contentsquare: abgelehnt/);
});

test('withdrawal while the tag is loading remains opted out when its load event arrives', () => {
  const h = harness();
  h.select({ contentsquare: true });
  h.reject();
  assert.ok(h.csCommands().some(command => command[0] === 'optout'));
  h.load('pe-contentsquare-tag');
  assert.equal(h.current().contentsquare, false);
  assert.equal(h.csCommands().at(-1)[0], 'optout');
  assert.equal(h.csScripts().length, 1);
});

test('re-grant after withdrawal preserves the form and resumes only on the next page load', () => {
  const h = harness();
  h.select({ contentsquare: true });
  h.load('pe-contentsquare-tag');
  h.reject();
  const privateValue = h.fields.get('[name="name"]').value;
  h.select({ contentsquare: true });
  assert.equal(h.current().contentsquare, true);
  assert.equal(h.csScripts().length, 1, 'Do not try to reinject an opted-out tag in the current document');
  assert.equal(h.reloadCount(), 0, 'Never reload and discard an unfinished form');
  assert.equal(h.fields.get('[name="name"]').value, privateValue);
  const next = harness({ cookies: Object.fromEntries(h.jar), path: '/news' });
  assert.equal(next.csScripts().length, 1);
  assert.equal(next.jar.has('_cs_optout'), false, 'Explicit renewed consent permits the next document to start again');
});

test('Google and Contentsquare remain independent when either consent changes', () => {
  const h = harness();
  h.select({ analytics: true, contentsquare: true });
  h.load('pe-google-tag');
  h.load('pe-contentsquare-tag');
  h.select({ contentsquare: true });
  assert.equal(h.current().analytics, false);
  assert.equal(h.current().contentsquare, true);
  assert.equal(h.csCommands().some(command => command[0] === 'optout'), false);
  h.select({ analytics: true });
  assert.equal(h.current().analytics, true);
  assert.equal(h.current().contentsquare, false);
  assert.ok(h.csCommands().some(command => command[0] === 'optout'));
  assert.equal(h.scripts.filter(script => script.id === 'pe-google-tag').length, 1);
  const update = h.googleCommands().filter(command => command[0] === 'consent' && command[1] === 'update').at(-1)[2];
  assert.equal(update.analytics_storage, 'granted');
  assert.equal(update.ad_storage, 'denied');
});
