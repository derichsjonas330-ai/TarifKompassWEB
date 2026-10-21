export const HUBSPOT_ENDPOINT =
  'https://api.hsforms.com/submissions/v3/integration/submit/149603841/5891a2d0-253e-4f3b-a2d3-f413811ac9f9';

type SubmissionData = Record<string, unknown>;
type Field = { objectTypeId: '0-1'; name: string; value: string };
export type HubSpotSubmission = {
  fields: Field[];
  context: { pageUri: string; pageName: string };
};

export class DeliveryError extends Error {
  readonly status: number | undefined;
  constructor(status?: number) {
    super(status ? `HubSpot submission rejected (HTTP ${status})` : 'HubSpot submission could not be delivered');
    this.name = 'DeliveryError';
    this.status = status;
  }
}

function value(data: SubmissionData, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : '';
}

// Only tariff requests routed through Netlify's verified form event qualify.
// The source field is a filter, not an authentication mechanism; Netlify verifies
// the platform event's signature before calling the handler.
export function toHubSpotSubmission(data: SubmissionData | undefined): HubSpotSubmission | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (value(data, 'pe_integration_source') !== 'tarifanfrage') return null;
  if (value(data, 'bot-field')) return null;
  if (value(data, 'form-name') && value(data, 'form-name') !== 'tarifanfrage') return null;

  const name = value(data, 'name');
  const phone = value(data, 'telefon');
  const email = value(data, 'email');
  if (name.length < 2 || name.length > 300 || (!phone && !email)) {
    throw new Error('Tariff request has incomplete contact data');
  }
  if (phone.length > 100 || email.length > 254 ||
      (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw new Error('Tariff request has invalid contact data');
  }
  if (value(data, 'datenschutzhinweis') !== 'zur Kenntnis genommen') {
    throw new Error('Tariff request is missing privacy notice acknowledgement');
  }

  const selectedEnergy = value(data, 'sparte');
  const lines: [string, string][] = [
    ['Tarifprüfung', value(data, 'beide_sparten') ? 'Strom und Gas' : selectedEnergy],
    ['Gewählte Sparte für die Verbrauchsangabe', selectedEnergy],
    ['Objekt', value(data, 'objekt')],
    [value(data, 'objekt') === 'Gewerbe' ? 'Beschäftigte im Betrieb' : 'Personen im Haushalt', value(data, 'personen')],
    ['Jahresverbrauch (kWh, Kundeneingabe)', value(data, 'kwh')],
    ['Aktuelle Versorgung', value(data, 'situation')],
    ['Aktueller Anbieter', value(data, 'anbieter')],
    ['Preiserhöhung / Sonderkündigungsrecht prüfen', value(data, 'erhoehung') ? 'Ja' : 'Nicht angegeben'],
    ['Gewünschter Rückruf', value(data, 'rueckruf')],
  ];
  const details = lines.filter(([, text]) => text).map(([label, text]) => `${label}: ${text}`).join('\n');
  if (details.length > 10000) throw new Error('Tariff request details exceed the supported length');

  const fields: Field[] = [];
  const add = (name: string, text: string) => {
    if (text) fields.push({ objectTypeId: '0-1', name, value: text });
  };
  add('pe_vollstandiger_name', name);
  // Preserve the customer input, including international prefixes. Do not
  // assume the US country selected by the HubSpot visual form preview.
  add('phone', phone);
  add('email', email);
  add('zip', value(data, 'plz'));
  add('pe_tarifanfrage_details', details);
  add('pe_vorgangs_id', value(data, 'vorgangs_id'));

  // No tracking cookie, browser IP, lead cookie ID or marketing subscription.
  return {
    fields,
    context: { pageUri: 'https://paschenenergie.de/#analyse', pageName: 'Paschen-Energie Tarifanfrage' },
  };
}

type DeliveryDependencies = {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export async function sendToHubSpot(payload: HubSpotSubmission, dependencies: DeliveryDependencies = {}): Promise<void> {
  const request = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const timeoutMs = dependencies.timeoutMs ?? 8000;

  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await request(HUBSPOT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      // Do not log fetch errors: some providers include request data in them.
      if (attempt === 2) throw new DeliveryError();
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    // Responses may contain echoed customer values; neither log nor persist them.
    await response.body?.cancel();
    if (response.ok) return;
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) throw new DeliveryError(response.status);
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1000, 8000)
      : 1000 * 2 ** attempt;
    await sleep(delay);
  }
}
