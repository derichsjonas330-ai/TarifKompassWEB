import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// Offline behavioral tests: no browser, network requests or production events.
const original = await readFile(new URL('../assets/cookie-consent.js', import.meta.url), 'utf8');
const GA = 'G-RB9D1EMFDZ';
const ADS = 'AW-18528448427';
const PHONE = `${ADS}/6-NtCJzgiKodEKvfhoNF`;
const BUSINESS_TEL = 'tel:+4917616818944';
const TEST_LABEL = 'OFFLINE_TEST_ONLY';
const timestamp = () => new Date(Date.now() - 1000).toISOString();
const saved = ({ analytics = false, ads = false, marketing = false, lead = false, version = '6' } = {}) =>
  [version, lead ? 'granted' : 'denied', analytics ? 'granted' : 'denied', marketing ? 'granted' : 'denied', ...(['5', '6'].includes(version) ? [ads ? 'granted' : 'denied'] : []), timestamp()].join('|');

function run({ choice, path = '/danke', referrer = '', label = TEST_LABEL, cookies = {}, links = [] } = {}) {
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
    const attributes = new Map();
    return {
      tagName: tag.toUpperCase(), nodeType: 1, childNodes: [], hidden: false, checked: false,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      get href() { return this.getAttribute('href') || ''; },
      set href(value) { this.setAttribute('href', value); },
      get textContent() { return this.childNodes.map(child => child.nodeType === 3 ? child.nodeValue : child.textContent).join(''); },
      focus() {},
      addEventListener(type, fn) { handlers.set(type, fn); },
      dispatch(type) { handlers.get(type)?.(); },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element('input'));
        return children.get(selector);
      },
      appendChild(child) {
        child.parentNode = this;
        this.childNodes.push(child);
        if (child.id) elements.set(child.id, child);
        if (child.tagName === 'SCRIPT') scripts.push(child);
      },
      insertBefore(child) { this.appendChild(child); },
    };
  }
  function domNode(value) {
    if (typeof value === 'string') return { nodeType: 3, nodeValue: value };
    const node = element(value.tag);
    for (const child of value.children || []) node.appendChild(domNode(child));
    return node;
  }
  const phoneLinks = links.map(({ href = BUSINESS_TEL, children = ['0176 16818944'] } = {}) => {
    const link = element('a');
    link.setAttribute('href', href);
    for (const child of children) link.appendChild(domNode(child));
    return link;
  });
  const document = {
    head: element('head'), body: element('body'), referrer,
    createElement: element,
    getElementById(id) { return id === 'konfForm' ? { querySelector: s => formFields.get(s) || null } : elements.get(id) || null; },
    getElementsByTagName(tag) { return tag === 'script' ? scripts : []; },
    querySelectorAll(selector) {
      assert.equal(selector, 'a[href^="tel:"]');
      return phoneLinks.filter(link => link.getAttribute('href')?.startsWith('tel:'));
    },
    createTreeWalker(root, filter) {
      assert.equal(filter, 4, 'Only text nodes should be walked');
      const nodes = [];
      function visit(node) {
        for (const child of node.childNodes || []) {
          if (child.nodeType === 3) nodes.push(child);
          else visit(child);
        }
      }
      visit(root);
      let index = 0;
      return { nextNode: () => nodes[index++] || null };
    },
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
    window, document, scripts, cookieJar, formFields, links: phoneLinks,
    commands: () => Array.from(window.dataLayer || [], args => Array.from(args)),
    conversions: () => Array.from(window.dataLayer || []).filter(args => args[0] === 'event' && args[1] === 'conversion'),
    configs: () => Array.from(window.dataLayer || []).filter(args => args[0] === 'config'),
    phoneConfigs: () => Array.from(window.dataLayer || []).filter(args => args[0] === 'config' && args[1] === PHONE),
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

test('compact banner keeps every decision available outside initially collapsed settings', () => {
  const h = run();
  const banner = h.document.getElementById('pe-cookie-banner');
  const html = banner.innerHTML;
  const disclosure = html.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(disclosure, 'Optional purpose details use a native keyboard-accessible disclosure');
  assert.doesNotMatch(disclosure[1], /\bopen\b/, 'Long details are initially collapsed');
  assert.match(disclosure[2], /<summary>[^<]+<\/summary>/);
  const visible = html.replace(disclosure[0], '');
  for (const decision of ['denied', 'selected', 'granted']) {
    assert.match(visible, new RegExp(`<button\\b[^>]*data-pe-cookie="${decision}"`));
  }
  for (const purpose of ['lead', 'analytics', 'marketing', 'ads']) {
    assert.equal(banner.querySelector(`#pe-consent-${purpose}`).checked, false);
  }
  for (const context of ['Paschen Energie', 'Lead-Zuordnung', 'Google-Statistik', 'Anrufmessung', 'Meta-Werbemessung', 'personalisierte Werbung', 'USA']) {
    assert.ok(visible.includes(context), `${context} remains visible before opening details`);
  }
  for (const context of ['Stefanos Paschen Vertrieb &amp; Energie', 'Google Analytics', 'Google Ads', 'Meta Pixel']) {
    assert.ok(disclosure[2].includes(context), `${context} remains available in the full disclosure`);
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

test('v5 consent preserves other choices but requires renewed Ads consent for call measurement', () => {
  const h = run({ choice: saved({ version: '5', lead: true, analytics: true, marketing: true, ads: true }), links: [{}] });
  const current = h.window.PaschenCookieConsent.getChoice();
  assert.equal(current.lead, true);
  assert.equal(current.analytics, true);
  assert.equal(current.marketing, true);
  assert.equal(current.ads, false);
  assert.equal(current.needsUpdate, true);
  const banner = h.document.getElementById('pe-cookie-banner');
  assert.equal(banner.hidden, false);
  assert.equal(banner.querySelector('#pe-consent-ads').checked, false);
  h.loadGoogle();
  assert.deepEqual(h.configs().map(c => c[1]), [GA]);
  assert.equal(h.phoneConfigs().length, 0);
  assert.equal(h.conversions().length, 0);
  h.select({ lead: true, analytics: true, marketing: true, ads: true });
  assert.equal(h.window.PaschenCookieConsent.getChoice().version, '7');
  assert.equal(h.window.PaschenCookieConsent.getChoice().needsUpdate, false);
  assert.equal(h.phoneConfigs().length, 1);
  assert.equal(h.conversions().length, 1);
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
  const h = run({ choice: saved({ ads: true }), cookies: { _gcl_aw: 'a', _gcl_au: 'b', _gcl_gs: 'c', gwcc: 'cached-phone', required: 'keep' } });
  h.loadGoogle();
  h.select();
  assert.equal(h.cookieJar.has('_gcl_aw'), false);
  assert.equal(h.cookieJar.has('_gcl_au'), false);
  assert.equal(h.cookieJar.has('_gcl_gs'), false);
  assert.equal(h.cookieJar.has('gwcc'), false);
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

test('phone measurement needs a matching business phone link and explicit Ads consent', () => {
  for (const choice of [undefined, saved(), saved({ analytics: true })]) {
    const h = run({ choice, path: '/', links: [{}] });
    if (h.scripts.length) h.loadGoogle();
    assert.equal(h.phoneConfigs().length, 0);
    assert.equal(h.links[0].href, BUSINESS_TEL);
    assert.equal(h.links[0].textContent, '0176 16818944');
  }
  for (const links of [[], [{ href: 'tel:+49211384240', children: ['+49 211 38424-0'] }]]) {
    const h = run({ choice: saved({ ads: true }), path: '/', links });
    h.loadGoogle();
    assert.equal(h.phoneConfigs().length, 0, 'No phone config for unrelated or absent numbers');
    assert.deepEqual(h.configs().map(c => c[1]), [ADS]);
  }
});

test('phone config waits for Google load and keeps the exact destination and number', () => {
  const h = run({ choice: saved({ ads: true }), path: '/', links: [{}] });
  assert.equal(h.phoneConfigs().length, 0);
  h.loadGoogle();
  assert.deepEqual(h.configs().map(c => c[1]), [ADS, PHONE]);
  const config = h.phoneConfigs()[0][2];
  assert.equal(config.phone_conversion_number, '0176 16818944');
  assert.equal(typeof config.phone_conversion_callback, 'function');
  assert.equal(config.phone_conversion_options.cache, false);
  assert.equal(h.conversions().length, 0, 'Registering the phone does not count a completed call');
  h.select({ ads: true });
  h.select({ ads: true, analytics: true });
  assert.equal(h.phoneConfigs().length, 1, 'Do not register again within one consent period');
  assert.equal(h.scripts.length, 1);
});

test('phone callback updates matching text and href while preserving CTA labels and nested markup', () => {
  const h = run({ choice: saved({ ads: true }), path: '/mobil.html', links: [
    { children: ['0176 16818944'] },
    { children: ['Oder direkt anrufen: 0176 16818944'] },
    { children: ['Lieber direkt anrufen'] },
    { children: [
      { tag: 'span', children: [{ tag: 'svg', children: [{ tag: 'path' }] }] },
      { tag: 'span', children: [
        { tag: 'span', children: ['Telefon'] },
        { tag: 'span', children: ['+49 176 16818944'] },
      ] },
    ] },
    { href: 'tel:+49211384240', children: ['+49 211 38424-0'] },
  ] });
  const icon = h.links[3].childNodes[0];
  const nestedLabel = h.links[3].childNodes[1].childNodes[0];
  h.loadGoogle();
  h.phoneConfigs()[0][2].phone_conversion_callback('0800 1234567', '+498001234567');
  assert.deepEqual(h.links.map(link => link.href), [
    'tel:+498001234567', 'tel:+498001234567', 'tel:+498001234567', 'tel:+498001234567', 'tel:+49211384240',
  ]);
  assert.deepEqual(h.links.map(link => link.textContent), [
    '0800 1234567', 'Oder direkt anrufen: 0800 1234567', 'Lieber direkt anrufen', 'Telefon0800 1234567', '+49 211 38424-0',
  ]);
  assert.equal(h.links[3].childNodes[0], icon);
  assert.equal(h.links[3].childNodes[1].childNodes[0], nestedLabel);
  assert.equal(h.conversions().length, 0);
});

test('withdrawing Ads consent restores numbers and rejects old callbacks even after renewed consent', () => {
  const h = run({ choice: saved({ ads: true }), path: '/', links: [
    { children: ['Oder direkt anrufen: 0176 16818944'] },
    { children: ['+49 176 16818944'] },
    { children: ['Persönlich anrufen'] },
  ] });
  const originalTexts = h.links.map(link => link.textContent);
  h.loadGoogle();
  const oldCallback = h.phoneConfigs()[0][2].phone_conversion_callback;
  oldCallback('0800 1234567', '+498001234567');
  h.select();
  assert.deepEqual(h.links.map(link => link.textContent), originalTexts);
  assert.ok(h.links.every(link => link.href === BUSINESS_TEL));
  oldCallback('0800 9999999', '+498009999999');
  assert.deepEqual(h.links.map(link => link.textContent), originalTexts);
  assert.ok(h.links.every(link => link.href === BUSINESS_TEL));
  h.select({ ads: true });
  assert.equal(h.phoneConfigs().length, 2);
  oldCallback('0800 9999999', '+498009999999');
  assert.deepEqual(h.links.map(link => link.textContent), originalTexts);
  assert.ok(h.links.every(link => link.href === BUSINESS_TEL));
  h.phoneConfigs()[1][2].phone_conversion_callback('0800 2222222', '+498002222222');
  assert.ok(h.links.every(link => link.href === 'tel:+498002222222'));
  assert.equal(h.links[0].textContent, 'Oder direkt anrufen: 0800 2222222');
  assert.equal(h.links[2].textContent, 'Persönlich anrufen');
});

test('withdrawal while Google loads blocks phone initialization until consent is renewed', () => {
  const h = run({ choice: saved({ ads: true }), path: '/', links: [{}] });
  h.select();
  h.loadGoogle();
  assert.equal(h.phoneConfigs().length, 0);
  assert.equal(h.links[0].href, BUSINESS_TEL);
  h.select({ ads: true });
  assert.equal(h.phoneConfigs().length, 1);
});

test('phone initialization and callback preserve the existing one-time form conversion', () => {
  const h = run({ choice: saved({ ads: true }), label: null, links: [{}] });
  h.loadGoogle();
  h.phoneConfigs()[0][2].phone_conversion_callback('0800 1234567', '+498001234567');
  h.select();
  h.select({ ads: true });
  assert.equal(h.conversions().length, 1);
  assert.equal(h.conversions()[0][2].send_to, 'AW-18528448427/Oo2-CN76uaUdEKvfhoNF');
});
