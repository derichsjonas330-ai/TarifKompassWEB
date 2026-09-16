(function(){
  'use strict';

  const VERSION = '1';
  const MAX_AGE = 60 * 60 * 24 * 180;
  const CHOICE_COOKIE = 'pe_cookie_choice';
  const LEAD_COOKIE = 'pe_lead_id';
  const FIRST_CONTACT_COOKIE = 'pe_first_contact';
  const pageEnteredAt = new Date().toISOString();

  function readCookie(name){
    const prefix = name + '=';
    const item = document.cookie.split('; ').find(function(part){ return part.indexOf(prefix) === 0; });
    if(!item) return '';
    try{ return decodeURIComponent(item.slice(prefix.length)); }
    catch(_error){ return ''; }
  }

  function writeCookie(name, value, maxAge){
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax; Secure';
  }

  function deleteCookie(name){
    document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax; Secure';
  }

  function parseChoice(){
    const raw = readCookie(CHOICE_COOKIE);
    if(!raw) return null;
    const parts = raw.split('|');
    if(parts.length !== 3 || parts[0] !== VERSION) return null;
    if(parts[1] !== 'granted' && parts[1] !== 'denied') return null;
    return {status:parts[1], at:parts[2]};
  }

  function createLeadId(){
    if(window.crypto && typeof window.crypto.randomUUID === 'function'){
      return 'PE-' + window.crypto.randomUUID().toUpperCase();
    }
    const bytes = new Uint8Array(16);
    if(window.crypto && typeof window.crypto.getRandomValues === 'function'){
      window.crypto.getRandomValues(bytes);
      return 'PE-' + Array.from(bytes, function(byte){ return byte.toString(16).padStart(2,'0'); }).join('').toUpperCase();
    }
    return 'PE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2,14).toUpperCase();
  }

  function ensureRequestId(form){
    const target = form || document.getElementById('konfForm');
    if(!target) return '';
    const requestField = target.querySelector('[name="vorgangs_id"]');
    if(!requestField) return '';
    if(!requestField.value) requestField.value = 'PE-A-' + createLeadId().slice(3);
    return requestField.value;
  }

  function ensureLeadCookies(firstContact){
    let leadId = readCookie(LEAD_COOKIE);
    let first = readCookie(FIRST_CONTACT_COOKIE);
    if(!leadId){
      leadId = createLeadId();
      writeCookie(LEAD_COOKIE, leadId, MAX_AGE);
    }
    if(!first){
      first = firstContact || pageEnteredAt;
      writeCookie(FIRST_CONTACT_COOKIE, first, MAX_AGE);
    }
    return {leadId:leadId, firstContact:first};
  }

  function clearLeadCookies(){
    deleteCookie(LEAD_COOKIE);
    deleteCookie(FIRST_CONTACT_COOKIE);
  }

  function syncLeadFields(form){
    const target = form || document.getElementById('konfForm');
    if(!target) return;
    const choice = parseChoice();
    const leadField = target.querySelector('[name="lead_id"]');
    const firstField = target.querySelector('[name="erstkontakt_zeitpunkt"]');
    const consentField = target.querySelector('[name="cookie_einwilligung"]');
    if(choice && choice.status === 'granted'){
      const lead = ensureLeadCookies();
      if(leadField) leadField.value = lead.leadId;
      if(firstField) firstField.value = lead.firstContact;
      if(consentField) consentField.value = 'Erteilt am ' + choice.at + ' (Version ' + VERSION + ')';
    } else {
      if(leadField) leadField.value = '';
      if(firstField) firstField.value = '';
      if(consentField) consentField.value = choice ? 'Abgelehnt am ' + choice.at + ' (Version ' + VERSION + ')' : 'Keine Entscheidung';
    }
  }

  function buildBanner(){
    const banner = document.createElement('section');
    banner.className = 'pe-cookie-banner';
    banner.id = 'pe-cookie-banner';
    banner.setAttribute('aria-label','Cookie-Einstellungen');
    banner.hidden = true;
    banner.innerHTML =
      '<div class="pe-cookie-panel">' +
        '<div class="pe-cookie-copy">' +
          '<h2>Ihre Entscheidung zu Cookies</h2>' +
          '<p>Mit Ihrer Zustimmung speichern wir für sechs Monate einen zufälligen Lead-Code und den Zeitpunkt Ihres ersten Besuchs. So können wir wiederkehrende Website-Anfragen eindeutig zuordnen und die vertraglich vereinbarte Abrechnung der Website-Leads nachweisen. Es findet keine Werbung und kein Profiling statt. Eine Ablehnung hat keine Nachteile. <a href="/datenschutz.html#cookies">Details in der Datenschutzerklärung</a>.</p>' +
        '</div>' +
        '<div class="pe-cookie-actions">' +
          '<button class="pe-cookie-choice" type="button" data-pe-cookie="denied">Nur erforderliche Cookies</button>' +
          '<button class="pe-cookie-choice" type="button" data-pe-cookie="granted">Lead-Cookies akzeptieren</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  let banner;

  function showBanner(){
    if(!banner) banner = buildBanner();
    banner.hidden = false;
  }

  function hideBanner(){
    if(banner) banner.hidden = true;
  }

  function saveChoice(status){
    const now = new Date().toISOString();
    writeCookie(CHOICE_COOKIE, VERSION + '|' + status + '|' + now, MAX_AGE);
    if(status === 'granted') ensureLeadCookies(pageEnteredAt);
    else clearLeadCookies();
    syncLeadFields();
    hideBanner();
    document.dispatchEvent(new CustomEvent('pe:cookie-choice',{detail:{status:status,at:now}}));
  }

  function openSettings(){
    showBanner();
    const firstButton = banner.querySelector('[data-pe-cookie="denied"]');
    if(firstButton) firstButton.focus();
  }

  document.addEventListener('click',function(event){
    const choiceButton = event.target.closest('[data-pe-cookie]');
    if(choiceButton){
      saveChoice(choiceButton.getAttribute('data-pe-cookie'));
      return;
    }
    if(event.target.closest('[data-pe-cookie-settings]')) openSettings();
  });

  banner = buildBanner();
  const choice = parseChoice();
  if(!choice){
    clearLeadCookies();
    showBanner();
  } else if(choice.status === 'granted'){
    ensureLeadCookies();
  } else {
    clearLeadCookies();
  }
  syncLeadFields();

  window.PaschenCookieConsent = {
    getChoice:parseChoice,
    openSettings:openSettings,
    syncLeadFields:syncLeadFields,
    ensureRequestId:ensureRequestId
  };
})();
