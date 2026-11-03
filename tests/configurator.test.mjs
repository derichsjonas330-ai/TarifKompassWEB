import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Offline behavior tests against the real form markup and script. Requests,
// navigation and consent services are local doubles; no real lead is submitted.
const source = await readFile(new URL('../assets/configurator.js', import.meta.url), 'utf8');
const pages = Object.fromEntries(await Promise.all(['index.html', 'mobil.html'].map(async name =>
  [name, await readFile(new URL('../' + name, import.meta.url), 'utf8')])));
const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, decode(value ?? '')]));
}

function harness(page = 'index.html', response = async () => ({ ok: true, status: 200 })) {
  const html = pages[page];
  const formMarkup = html.match(/<form\b[^>]*id="konfForm"[^>]*>[\s\S]*?<\/form>/)[0];
  const elements = new Map(), controls = [], requests = [], redirects = [], hooks = [], scrolls = [], focuses = [];
  let focused;
  function element(attrs = {}) {
    const handlers = new Map(), classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const node = {
      id: attrs.id || '', name: attrs.name || '', type: attrs.type || '', value: attrs.value ?? '',
      checked: 'checked' in attrs, disabled: 'disabled' in attrs, hidden: 'hidden' in attrs,
      required: 'required' in attrs, textContent: '', innerHTML: '', dataset: {},
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        toggle(value, force) { const enabled = force ?? !classes.has(value); if (enabled) classes.add(value); else classes.delete(value); return enabled; },
      },
      get className() { return [...classes].join(' '); },
      set className(value) { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
      getAttribute: key => attrs[key] ?? null,
      setAttribute(key, value) { attrs[key] = String(value); },
      removeAttribute(key) { delete attrs[key]; },
      hasAttribute: key => key in attrs,
      addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(callback); },
      async dispatch(type, event = {}) { for (const handler of handlers.get(type) || []) await handler({ target: node, preventDefault() {}, ...event }); },
      focus(options) { focused = node; focuses.push({ node, options }); },
      closest(selector) { return selector === '.field' ? node.field : selector === '.tile' ? node.tile : null; },
    };
    for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5)] = value;
    if (node.id) elements.set(node.id, node);
    return node;
  }
  for (const match of formMarkup.matchAll(/<[\w-]+\b[^>]*\bid="[^"]+"[^>]*>/g)) element(attributes(match[0]));
  for (const match of formMarkup.matchAll(/<input\b[^>]*>|<select\b[^>]*>[\s\S]*?<\/select>/g)) {
    const tag = match[0], opening = tag.match(/^<[^>]+>/)[0], attrs = attributes(opening);
    const control = element(attrs);
    control.field = element({ class: 'field' });
    if (control.type === 'radio') control.tile = element({ class: 'tile' });
    if (tag.startsWith('<select')) {
      const options = [...tag.matchAll(/<option\b[^>]*>/g)].map(match => attributes(match[0]));
      control.value = (options.find(option => 'selected' in option) || options[0])?.value ?? '';
    }
    control.initial = { value: control.value, checked: control.checked, disabled: control.disabled };
    controls.push(control);
  }
  const steps = [...formMarkup.matchAll(/<section\b[^>]*class="konf-step[^>]*>/g)].map(match => element(attributes(match[0])));
  const barMarkup = html.match(/<div class="konf-bar"[^>]*>([\s\S]*?)<\/div>/)[1];
  const bars = [...barMarkup.matchAll(/<i\b[^>]*>/g)].map(match => element(attributes(match[0])));
  const submitButton = element({ type: 'submit' });
  submitButton.textContent = 'Sparangebot kostenlos anfordern';
  const radios = controls.filter(control => control.type === 'radio');
  for (const input of radios) {
    let selected = input.checked;
    Object.defineProperty(input, 'checked', {
      get: () => selected,
      set(value) {
        selected = !!value;
        if (selected) radios.filter(other => other !== input && other.name === input.name).forEach(other => { other.checked = false; });
      },
    });
  }
  const named = name => controls.find(control => control.name === name);
  const form = element(attributes(formMarkup.match(/^<[^>]+>/)[0]));
  form.querySelectorAll = selector => {
    if (selector === '.konf-step') return steps;
    if (selector === '.tile input') return radios;
    if (selector === '.field.bad') return controls.map(control => control.field).filter(field => field.classList.contains('bad'));
    throw new Error('Unsupported form selector: ' + selector);
  };
  form.querySelector = selector => {
    if (selector === 'button[type="submit"]') return submitButton;
    const radio = selector.match(/^input\[name="([^"]+)"\]\[value="([^"]+)"\]$/);
    if (radio) return radios.find(input => input.name === radio[1] && input.value === radio[2]) || null;
    const name = selector.match(/^\[name="([^"]+)"\]$/)?.[1];
    if (name) return named(name) || null;
    if (selector.startsWith('#')) return elements.get(selector.slice(1)) || null;
    throw new Error('Unsupported form selector: ' + selector);
  };
  for (const name of ['sparte', 'objekt']) Object.defineProperty(form, name, { get: () => ({ value: radios.find(input => input.name === name && input.checked)?.value || '' }) });
  form.reset = () => controls.forEach(control => Object.assign(control, control.initial));
  const card = element();
  card.querySelectorAll = selector => { assert.equal(selector, '.konf-bar i'); return bars; };
  card.getBoundingClientRect = () => ({ top: 100 });
  card.scrollIntoView = () => {};
  const document = Object.assign(element(), {
    getElementById: id => id === 'konfForm' ? form : elements.get(id) || null,
    querySelector: selector => selector === '.konf' ? card : null,
  });
  const location = new URL(page === 'mobil.html' ? 'https://paschenenergie.de/mobil.html' : 'https://paschenenergie.de/');
  location.assign = path => redirects.push(path);
  let reducedMotion = false;
  const window = {
    location,
    scrollTo: options => scrolls.push({ ...options }),
    matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion }),
    history: {
      replaceState(data, title, href) { location.href = new URL(href, location.href).href; },
      pushState(data, title, href) { location.href = new URL(href, location.href).href; },
    },
    PaschenCookieConsent: {
      syncLeadFields(target) { assert.equal(target, form); hooks.push('sync'); named('cookie_einwilligung').value = 'OFFLINE_CONSENT'; },
      ensureRequestId(target) { assert.equal(target, form); hooks.push('id'); named('vorgangs_id').value = 'OFFLINE_REQUEST_ID'; },
    },
  };
  class LocalFormData {
    constructor(target) { assert.equal(target, form); }
    *[Symbol.iterator]() {
      for (const control of controls) {
        if (!control.name || control.disabled || (['checkbox', 'radio'].includes(control.type) && !control.checked)) continue;
        yield [control.name, control.value];
      }
    }
  }
  vm.runInNewContext(source, {
    window, document, Intl, URL, URLSearchParams, location, history: window.history, matchMedia: window.matchMedia, FormData: LocalFormData,
    fetch: async (url, options) => { requests.push({ url, ...options, data: new URLSearchParams(options.body) }); return response(requests.length); },
  }, { timeout: 1000 });
  const h = {
    form, elements, controls, steps, bars, submitButton, requests, redirects, hooks, scrolls, focuses,
    get: id => { assert.ok(elements.has(id), 'Missing real form element: ' + id); return elements.get(id); },
    value(id, value) { h.get(id).value = value; },
    async change(id, checked) { const input = h.get(id); input.checked = checked; await input.dispatch('change'); },
    async choose(name, value) {
      const input = radios.find(input => input.name === name && input.value === value);
      assert.ok(input); radios.filter(input => input.name === name).forEach(input => { input.checked = input.value === value; });
      await input.dispatch('change');
    },
    click: action => form.dispatch('click', { target: { closest: selector => selector === `[data-${action}]` ? {} : null } }),
    async cta(href = '#analyse', modifiers = {}, attributes = {}) {
      const link = element({ href, ...attributes });
      link.href = new URL(href, location.href).href;
      link.target = attributes.target || '';
      let prevented = false;
      await document.dispatch('click', {
        button: 0, defaultPrevented: false,
        target: { closest: selector => selector.startsWith('a') ? link : null },
        preventDefault() { prevented = true; },
        ...modifiers,
      });
      return prevented;
    },
    reducedMotion(value) { reducedMotion = value; },
    submit: () => form.dispatch('submit'),
    active: () => steps.filter(step => !step.hidden).map(step => step.dataset.step),
    focused: () => focused,
    tariff() { h.value('k-plz', '01067'); h.value('k-kwh', '3.200'); },
    contact(channel = 'phone') {
      h.value('k-name', 'Offline Testperson');
      h.value(channel === 'phone' ? 'k-telefon' : 'k-email', channel === 'phone' ? '+49 30 1234567' : 'offline@example.invalid');
      h.get('k-consent').checked = true;
    },
  };
  return h;
}

for (const page of Object.keys(pages)) {
  test(`${page}: two input steps, unchanged Netlify routing and no required second contact channel`, async () => {
    const h = harness(page);
    assert.equal(h.steps.length, 3, 'Two input steps plus success confirmation');
    assert.equal(h.bars.length, 2);
    assert.deepEqual(h.active(), ['1']);
    assert.equal(h.form.getAttribute('data-netlify'), 'true');
    assert.equal(h.form.getAttribute('netlify-honeypot'), 'bot-field');
    assert.equal(h.form.getAttribute('action'), '/danke');
    assert.equal(h.get('k-telefon').required, false);
    assert.equal(h.get('k-email').required, false);
    for (const name of ['situation', 'anbieter', 'erhoehung', 'rueckruf']) {
      const control = h.controls.find(control => control.name === name);
      assert.equal(control.type, 'hidden'); assert.equal(control.value, '');
    }
    h.tariff(); await h.click('next');
    assert.deepEqual(h.active(), ['2']);
    await h.click('back');
    assert.deepEqual(h.active(), ['1']);
    assert.equal(h.get('k-kwh').value, '3.200');
  });
}

test('first step validates ZIP and consumption, including Enter without premature submission', async () => {
  const h = harness();
  await h.click('next');
  assert.deepEqual(h.active(), ['1']); assert.equal(h.focused(), h.get('k-plz'));
  h.value('k-plz', '01067');
  for (const value of ['', '0', '-1', 'abc']) {
    h.value('k-kwh', value); await h.click('next');
    assert.deepEqual(h.active(), ['1']); assert.equal(h.focused(), h.get('k-kwh'));
  }
  h.tariff(); h.contact();
  await h.submit();
  assert.deepEqual(h.active(), ['2']); assert.equal(h.requests.length, 0); assert.deepEqual(h.redirects, []);
});

for (const page of Object.keys(pages)) {
  test(`${page}: offer links return to the hero and first step without deleting entered data or validating`, async () => {
    const h = harness(page); h.tariff();
    await h.choose('sparte', 'Gas'); await h.choose('objekt', 'Haus');
    await h.click('next');
    h.value('k-name', 'Offline Testperson'); h.value('k-email', 'unfinished@example');
    await h.submit();
    assert.equal(h.get('err4').classList.contains('on'), true);
    assert.equal(await h.cta(), true, 'Normal offer-link clicks are handled on the current page');
    assert.deepEqual(h.active(), ['1']);
    assert.equal(h.get('k-plz').value, '01067'); assert.equal(h.get('k-kwh').value, '3.200');
    assert.equal(h.form.sparte.value, 'Gas'); assert.equal(h.form.objekt.value, 'Haus');
    assert.equal(h.get('k-name').value, 'Offline Testperson'); assert.equal(h.get('k-email').value, 'unfinished@example');
    assert.equal(h.get('err4').classList.contains('on'), false);
    assert.equal(h.controls.some(input => input.field.classList.contains('bad')), false);
    assert.equal(h.scrolls.at(-1).top, 0, 'Keep the heading above the form in view');
    assert.equal(h.requests.length, 0);
    h.value('k-plz', ''); await h.click('next');
    assert.equal(h.get('err2').classList.contains('on'), true);
    assert.equal(await h.cta(), true, 'Repeated entry also clears old validation');
    assert.equal(h.get('k-plz').value, '');
    assert.equal(h.get('err2').classList.contains('on'), false);
    assert.equal(h.requests.length, 0);
  });
}

test('modified clicks and links to other destinations retain normal browser behavior', async () => {
  const cases = [
    ['#analyse', { ctrlKey: true }], ['#analyse', { metaKey: true }],
    ['#analyse', { shiftKey: true }], ['#analyse', { altKey: true }],
    ['#analyse', { button: 1 }], ['#analyse', {}, { target: '_blank' }],
    ['#analyse', {}, { download: 'offer.html' }],
    ['https://example.invalid/#analyse', {}], ['tel:+4917616818944', {}],
    ['#kontakt', {}], ['/news#analyse', {}],
  ];
  for (const [href, modifiers, attributes] of cases) {
    const h = harness(); h.tariff(); await h.click('next');
    const scrollCount = h.scrolls.length;
    assert.equal(await h.cta(href, modifiers, attributes), false, href + ' keeps browser behavior');
    assert.deepEqual(h.active(), ['2']); assert.equal(h.scrolls.length, scrollCount);
    assert.equal(h.requests.length, 0);
  }
});

test('step changes and invalid fields keep the hero at the top instead of scrolling a field over the heading', async () => {
  const h = harness();
  await h.click('next');
  assert.equal(h.focused(), h.get('k-plz')); assert.equal(h.focuses.at(-1).options.preventScroll, true);
  assert.equal(h.scrolls.at(-1).top, 0);
  h.tariff(); await h.click('next');
  assert.deepEqual(h.active(), ['2']); assert.equal(h.scrolls.at(-1).top, 0);
  assert.equal(h.focuses.at(-1).options.preventScroll, true);
  await h.submit(); assert.equal(h.focused(), h.get('k-name'));
  assert.equal(h.focuses.at(-1).options.preventScroll, true); assert.equal(h.scrolls.at(-1).top, 0);
  await h.click('back'); assert.deepEqual(h.active(), ['1']); assert.equal(h.scrolls.at(-1).top, 0);
  h.reducedMotion(true); await h.cta();
  assert.notEqual(h.scrolls.at(-1).behavior, 'smooth', 'Reduced-motion preference prevents animated scrolling');
});

test('unknown private electricity shows optional household size and omits stale kWh', async () => {
  const h = harness(); h.tariff();
  assert.equal(h.get('k-pers-field').hidden, true); assert.equal(h.get('k-pers').disabled, true);
  await h.change('k-unbekannt', true);
  assert.equal(h.get('k-pers-field').hidden, false); assert.equal(h.get('k-pers').disabled, false);
  assert.equal(h.get('k-kwh').disabled, true);
  h.value('k-pers', '3'); await h.click('next'); h.contact(); await h.submit();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].data.get('personen'), '3'); assert.equal(h.requests[0].data.has('kwh'), false);
  assert.match(h.requests[0].data.get('verbrauch_berechnet'), /nicht|unbekannt/i);
  assert.doesNotMatch(h.requests[0].data.get('verbrauch_berechnet'), /3[.,]?200/);
});

test('known consumption after changing the choice never serializes stale household size', async () => {
  const h = harness(); h.tariff(); await h.change('k-unbekannt', true); h.value('k-pers', '4');
  await h.change('k-unbekannt', false);
  assert.equal(h.get('k-pers-field').hidden, true); assert.equal(h.get('k-pers').disabled, true);
  h.value('k-kwh', '3500'); await h.click('next'); h.contact(); await h.submit();
  assert.equal(h.requests[0].data.has('personen'), false);
  assert.equal(h.requests[0].data.get('kwh'), '3500');
});

test('unknown household consumption does not require a guessed household size', async () => {
  const h = harness(); h.value('k-plz', '01067'); await h.change('k-unbekannt', true);
  assert.equal(h.get('k-pers').value, '');
  await h.click('next'); h.contact(); await h.submit();
  assert.equal(h.requests.length, 1); assert.deepEqual(h.redirects, ['/danke']);
  assert.equal(h.requests[0].data.get('personen'), '');
  assert.equal(h.requests[0].data.has('kwh'), false);
});

test('unknown Gas, Heizstrom and commercial consumption use clarification without household estimates', async () => {
  for (const [energy, object] of [['Gas', 'Wohnung'], ['Heizstrom', 'Haus'], ['Strom', 'Gewerbe']]) {
    const h = harness(); h.value('k-plz', '01067');
    await h.choose('sparte', energy); await h.choose('objekt', object); await h.change('k-unbekannt', true);
    assert.equal(h.get('k-pers-field').hidden, true); assert.equal(h.get('k-pers').disabled, true);
    await h.click('next'); assert.deepEqual(h.active(), ['2']); h.contact('email'); await h.submit();
    assert.equal(h.requests[0].data.has('personen'), false); assert.equal(h.requests[0].data.has('kwh'), false);
    assert.match(h.requests[0].data.get('verbrauch_berechnet'), /nicht|unbekannt/i);
  }
});

test('heat-pump selection and joint electricity/gas inquiry cannot silently overwrite each other', async () => {
  const h = harness();
  await h.choose('sparte', 'Heizstrom');
  await h.change('k-beide', true);
  assert.equal(h.form.sparte.value, 'Strom');
  assert.equal(h.get('k-beide').checked, true);
  assert.match(h.get('k-verbrauch-hint').textContent, /zweiten Sparte/);
  await h.choose('sparte', 'Heizstrom');
  assert.equal(h.get('k-beide').checked, false);
  assert.equal(h.form.sparte.value, 'Heizstrom');
  h.tariff(); await h.click('next'); h.contact(); await h.submit();
  assert.equal(h.requests[0].data.get('sparte'), 'Heizstrom');
  assert.equal(h.requests[0].data.has('beide_sparten'), false);
  assert.match(h.requests[0].data.get('verbrauch_berechnet'), /Heizstrom/);
});

for (const channel of ['phone', 'email']) {
  test(`${channel}-only submission preserves contact, consent metadata and server route`, async () => {
    const h = harness(); h.tariff(); await h.click('next'); h.contact(channel); await h.submit();
    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.url, '/'); assert.equal(request.method, 'POST');
    assert.equal(request.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.equal(request.data.get('form-name'), 'tarifanfrage');
    assert.equal(request.data.get('pe_integration_source'), 'tarifanfrage');
    assert.equal(request.data.get('plz'), '01067');
    assert.equal(request.data.get('datenschutzhinweis'), 'zur Kenntnis genommen');
    assert.equal(request.data.get('kontakt'), request.data.get(channel === 'phone' ? 'telefon' : 'email'));
    assert.equal(request.data.get(channel === 'phone' ? 'email' : 'telefon'), '');
    assert.equal(request.data.get('cookie_einwilligung'), 'OFFLINE_CONSENT');
    assert.equal(request.data.get('vorgangs_id'), 'OFFLINE_REQUEST_ID');
    assert.deepEqual(h.hooks, ['sync', 'id']); assert.deepEqual(h.redirects, ['/danke']);
    assert.deepEqual(h.active(), ['success']);
  });
}

test('missing contact, invalid contact and missing acknowledgement cannot submit', async () => {
  const h = harness(); h.tariff(); await h.click('next'); h.value('k-name', 'Offline Testperson'); h.get('k-consent').checked = true;
  await h.submit(); assert.equal(h.requests.length, 0);
  h.value('k-email', 'invalid'); await h.submit(); assert.equal(h.requests.length, 0);
  h.value('k-email', ''); h.value('k-telefon', 'abc'); await h.submit(); assert.equal(h.requests.length, 0);
  h.contact(); h.get('k-consent').checked = false; await h.submit(); assert.equal(h.requests.length, 0);
  assert.deepEqual(h.redirects, []);
});

test('final submission revalidates tariff data rather than trusting an earlier successful step', async () => {
  const h = harness(); h.tariff(); await h.click('next'); h.contact();
  h.value('k-plz', '123'); await h.submit();
  assert.equal(h.requests.length, 0); assert.deepEqual(h.redirects, []);
  assert.deepEqual(h.active(), ['1']);
  h.tariff(); await h.click('next'); h.value('k-kwh', ''); await h.submit();
  assert.equal(h.requests.length, 0); assert.deepEqual(h.active(), ['1']);
});

test('pending delivery cannot submit twice and success appears only after the response', async () => {
  let resolveResponse;
  const h = harness('index.html', () => new Promise(resolve => { resolveResponse = resolve; }));
  h.tariff(); await h.click('next'); h.contact();
  const pending = h.submit();
  assert.equal(h.requests.length, 1); assert.equal(h.submitButton.disabled, true);
  assert.deepEqual(h.active(), ['2']); assert.deepEqual(h.redirects, []);
  await h.submit(); assert.equal(h.requests.length, 1);
  await h.click('back'); assert.deepEqual(h.active(), ['2'], 'Navigation stays locked during delivery');
  const scrollCount = h.scrolls.length;
  assert.equal(await h.cta(), true, 'Offer entry is intercepted while delivery is pending');
  assert.deepEqual(h.active(), ['2']); assert.equal(h.scrolls.length, scrollCount);
  resolveResponse({ ok: true, status: 200 }); await pending;
  assert.deepEqual(h.active(), ['success']); assert.deepEqual(h.redirects, ['/danke']);
});

for (const failure of ['server', 'network']) {
  test(`${failure} failure preserves inputs, shows an error and permits a successful retry`, async () => {
    const h = harness('mobil.html', async count => {
      if (count > 1) return { ok: true, status: 200 };
      if (failure === 'network') throw new TypeError('Offline network failure');
      return { ok: false, status: 503 };
    });
    h.tariff(); await h.click('next'); h.contact(); await h.submit();
    assert.deepEqual(h.active(), ['2']); assert.deepEqual(h.redirects, []);
    assert.equal(h.submitButton.disabled, false); assert.equal(h.get('err4').classList.contains('on'), true);
    assert.equal(h.get('k-name').value, 'Offline Testperson');
    await h.submit(); assert.equal(h.requests.length, 2); assert.deepEqual(h.redirects, ['/danke']);
  });
}
