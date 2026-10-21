import type { FormSubmittedEvent } from '@netlify/functions';
import { toHubSpotSubmission, sendToHubSpot } from '../lib/hubspot-submission.mts';

// Netlify verifies its signed platform event. There is deliberately no fetch
// handler or public forwarding endpoint, and the existing form POST is unchanged.
export default {
  async formSubmitted(event: FormSubmittedEvent): Promise<void> {
    if (Netlify.env.get('HUBSPOT_FORM_FORWARDING') === 'disabled') return;
    const payload = toHubSpotSubmission(event.data);
    if (!payload) return;
    await sendToHubSpot(payload);
    console.info('Tariff request forwarded to HubSpot');
  },
};
