import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DeliveryError, HUBSPOT_ENDPOINT, sendToHubSpot, toHubSpotSubmission } from '../netlify/lib/hubspot-submission.mts';

const example = {
  'pe_integration_source': 'tarifanfrage',
  'form-name': 'tarifanfrage',
  name: 'Dr. Alex Maria Beispiel',
  telefon: '+49 30 23125 000',
  email: '',
  plz: '01067',
  sparte: 'Gas',
  beide_sparten: 'Strom und Gas gemeinsam prüfen',
  objekt: 'Haus',
  personen: '3',
  kwh: '12.000',
  situation: 'Laufender Vertrag',
  anbieter: 'Beispielanbieter',
  erhoehung: 'Ja, Preiserhöhung erhalten',
  rueckruf: 'Vormittags (9–12 Uhr)',
  vorgangs_id: 'PE-TEST-001',
  datenschutzhinweis: 'zur Kenntnis genommen',
};

test('phone-only request preserves full name, phone and leading zero ZIP without invented email', () => {
  const payload = toHubSpotSubmission(example)!;
  const fields = Object.fromEntries(payload.fields.map(field => [field.name, field.value]));
  assert.equal(fields.pe_vollstandiger_name, example.name);
  assert.equal(fields.phone, example.telefon);
  assert.equal(fields.zip, '01067');
  assert.equal(fields.email, undefined);
  assert.equal(fields.pe_vorgangs_id, example.vorgangs_id);
  assert.match(fields.pe_tarifanfrage_details, /Tarifprüfung: Strom und Gas/);
  assert.match(fields.pe_tarifanfrage_details, /Gewählte Sparte für die Verbrauchsangabe: Gas/);
  assert.match(fields.pe_tarifanfrage_details, /Jahresverbrauch \(kWh, Kundeneingabe\): 12\.000/);
  assert.ok(payload.fields.every(field => field.objectTypeId === '0-1'));
});

test('email-only requests work without a phone number', () => {
  const payload = toHubSpotSubmission({ ...example, telefon: '', email: 'person@example.com' })!;
  assert.equal(payload.fields.find(field => field.name === 'email')?.value, 'person@example.com');
  assert.ok(!payload.fields.some(field => field.name === 'phone'));
});

test('only explicit tariff source is forwarded; unknown forms and honeypot spam are skipped', () => {
  assert.equal(toHubSpotSubmission(undefined), null);
  assert.equal(toHubSpotSubmission({ ...example, pe_integration_source: '' }), null);
  assert.equal(toHubSpotSubmission({ ...example, 'form-name': 'newsletter' }), null);
  assert.equal(toHubSpotSubmission({ ...example, 'bot-field': 'bot' }), null);
  // Netlify may remove its own routing field. Our explicit source marker remains.
  const { 'form-name': _ignored, ...withoutRoutingField } = example;
  assert.ok(toHubSpotSubmission(withoutRoutingField));
});

test('tracking data and unrelated form fields never reach HubSpot', () => {
  const payload = toHubSpotSubmission({
    ...example, lead_id: 'TRACKING-SECRET', erstkontakt_zeitpunkt: 'TRACKING-SECRET',
    cookie_einwilligung: 'TRACKING-SECRET', subject: 'TRACKING-SECRET',
    ip: 'TRACKING-SECRET', hutk: 'TRACKING-SECRET', sparpotenzial: 'TRACKING-SECRET',
  })!;
  assert.ok(!JSON.stringify(payload).includes('TRACKING-SECRET'));
  assert.deepEqual(Object.keys(payload.context).sort(), ['pageName', 'pageUri']);
  assert.equal('legalConsentOptions' in payload, false);
  assert.equal('skipValidation' in payload, false);
});

test('invalid or incomplete requests fail visibly with no personal data in errors', () => {
  assert.throws(() => toHubSpotSubmission({ ...example, telefon: '', email: '' }), /incomplete contact data/);
  assert.throws(() => toHubSpotSubmission({ ...example, datenschutzhinweis: '' }), /privacy notice acknowledgement/);
  assert.throws(() => toHubSpotSubmission({ ...example, email: 'private invalid address' }), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes('private'));
    return true;
  });
});

test('delivery posts the exact six-field mapping to the fixed destination', async () => {
  const payload = toHubSpotSubmission({ ...example, email: 'person@example.com' })!;
  let calls = 0;
  await sendToHubSpot(payload, {
    fetch: (async (url, init) => {
      calls++;
      assert.equal(url, HUBSPOT_ENDPOINT);
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(String(init?.body)), payload);
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(calls, 1);
  assert.equal(payload.fields.length, 6);
});

test('429 and transient server errors are retried within a bounded delay', async () => {
  const delays: number[] = [];
  let calls = 0;
  await sendToHubSpot(toHubSpotSubmission(example)!, {
    fetch: (async () => {
      calls++;
      return calls === 1
        ? new Response('private customer data', { status: 429, headers: { 'Retry-After': '9999' } })
        : calls === 2 ? new Response('', { status: 503 }) : new Response('{}');
    }) as typeof fetch,
    sleep: async milliseconds => { delays.push(milliseconds); },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [8000, 2000]);
});

test('nonretryable validation failure throws without exposing the response body', async () => {
  let calls = 0;
  await assert.rejects(sendToHubSpot(toHubSpotSubmission(example)!, {
    fetch: (async () => { calls++; return new Response('person@example.com private', { status: 400 }); }) as typeof fetch,
  }), error => {
    assert.ok(error instanceof DeliveryError);
    assert.equal(error.status, 400);
    assert.ok(!error.message.includes('person@example.com'));
    return true;
  });
  assert.equal(calls, 1);
});

test('network failures are attempted three times then propagated for platform retry', async () => {
  let calls = 0;
  await assert.rejects(sendToHubSpot(toHubSpotSubmission(example)!, {
    fetch: (async () => { calls++; throw new Error('private request payload'); }) as typeof fetch,
    sleep: async () => {},
  }), error => {
    assert.ok(error instanceof DeliveryError);
    assert.ok(!error.message.includes('private'));
    return true;
  });
  assert.equal(calls, 3);
});
