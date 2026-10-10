(function(){
  'use strict';

  if(window.PaschenCookieConsent) return;

  const VERSION = '3';
  const MEASUREMENT_ID = 'G-RB9D1EMFDZ';
  const META_PIXEL_ID = '1853128992346096';
  const MAX_AGE = 60 * 60 * 24 * 180;
  const CHOICE_COOKIE = 'pe_cookie_choice';
  const LEAD_COOKIE = 'pe_lead_id';
  const FIRST_CONTACT_COOKIE = 'pe_first_contact';
  const pageEnteredAt = new Date().toISOString();
  let analyticsStarted = false;
  let metaStarted = false;
  let metaReady = false;
  let metaPageViewSent = false;
  window['ga-disable-' + MEASUREMENT_ID] = true;

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
    // Preserve earlier lead/analytics choices, but never infer Meta consent.
    const legacy = parts[0] === '2' && parts.length === 4;
    if(!legacy && (parts[0] !== VERSION || parts.length !== 5)) return null;
    const purposes = legacy ? parts.slice(1,3) : parts.slice(1,4);
    if(!purposes.every(function(value){ return ['granted','denied'].includes(value); })) return null;
    const at = parts[legacy ? 3 : 4];
    const timestamp = Date.parse(at);
    if(!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp >= MAX_AGE * 1000) return null;
    return {status:parts[1], lead:parts[1] === 'granted', analytics:parts[2] === 'granted', marketing:!legacy && parts[3] === 'granted', at:at, version:parts[0], needsUpdate:legacy};
  }

  function clearCookies(names){
    const domains = ['', window.location.hostname, '.' + window.location.hostname];
    const parts = window.location.hostname.split('.');
    while(parts.length > 2){
      parts.shift();
      domains.push(parts.join('.'), '.' + parts.join('.'));
    }
    document.cookie.split(';').forEach(function(cookie){
      const name = cookie.trim().split('=')[0];
      if(!names.includes(name)) return;
      domains.forEach(function(domain){
        document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax; Secure' + (domain ? '; Domain=' + domain : '');
      });
    });
  }

  function clearAnalyticsCookies(){
    clearCookies(['_ga', '_ga_' + MEASUREMENT_ID.slice(2)]);
  }

  function clearMarketingCookies(){
    clearCookies(['_fbp', '_fbc']);
  }

  function consentSettings(granted){
    return {
      analytics_storage:granted ? 'granted' : 'denied',
      ad_storage:'denied',
      ad_user_data:'denied',
      ad_personalization:'denied'
    };
  }

  function withoutUrlParameters(value){
    if(!value) return '';
    try{ const url = new URL(value); return url.origin + url.pathname; }
    catch(_error){ return ''; }
  }

  function syncAnalytics(granted){
    window['ga-disable-' + MEASUREMENT_ID] = !granted;
    if(!granted){
      if(analyticsStarted) window.gtag('consent', 'update', consentSettings(false));
      clearAnalyticsCookies();
      return;
    }
    if(analyticsStarted){
      window.gtag('consent', 'update', consentSettings(true));
      return;
    }
    analyticsStarted = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
    // Basic consent mode: no Google script or request before analytics opt-in.
    window.gtag('consent', 'default', consentSettings(false));
    window.gtag('consent', 'update', consentSettings(true));
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID, {
      allow_google_signals:false,
      allow_ad_personalization_signals:false,
      page_location:withoutUrlParameters(window.location.href),
      page_referrer:withoutUrlParameters(document.referrer),
      cookie_expires:MAX_AGE,
      cookie_update:false,
      cookie_flags:'SameSite=Lax;Secure'
    });
    const script = document.createElement('script');
    script.id = 'pe-google-analytics';
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    script.addEventListener('load', function(){
      const choice = parseChoice();
      if(!choice || !choice.analytics) syncAnalytics(false);
    });
    document.head.appendChild(script);
  }

  function syncMarketing(granted){
    if(!granted){
      if(metaStarted && typeof window.fbq === 'function') window.fbq('consent', 'revoke');
      clearMarketingCookies();
      return;
    }
    if(!metaStarted){
      metaStarted = true;
      // Meta Pixel base code: even the SDK is loaded only after marketing opt-in.
      !function(f,b,e,v,n,t,s){
        if(f.fbq) return;
        n=f.fbq=function(){n.callMethod ? n.callMethod.apply(n,arguments) : n.queue.push(arguments);};
        if(!f._fbq) f._fbq=n;
        n.push=n; n.loaded=true; n.version='2.0'; n.queue=[];
        t=b.createElement(e); t.id='pe-meta-pixel'; t.async=true; t.src=v;
        t.addEventListener('load',function(){
          metaReady = true;
          const choice = parseChoice();
          syncMarketing(!!(choice && choice.marketing));
        });
        s=b.getElementsByTagName(e)[0];
        if(s) s.parentNode.insertBefore(t,s);
        else b.head.appendChild(t);
      }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('consent', 'revoke');
      // Keep this integration to PageView; do not enable automatic form events.
      window.fbq('set', 'autoConfig', false, META_PIXEL_ID);
      window.fbq('optOut', META_PIXEL_ID, 'AutomaticMatching');
      window.fbq('optOut', META_PIXEL_ID, 'AutomaticMatchingForPartnerIntegrations');
      window.fbq('init', META_PIXEL_ID);
    }
    // Recheck consent after SDK loading, so a quick withdrawal cannot send a queued PageView.
    if(!metaReady) return;
    window.fbq('consent', 'grant');
    if(!metaPageViewSent){
      window.fbq('track', 'PageView');
      metaPageViewSent = true;
    }
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
    if(choice && choice.lead){
      const lead = ensureLeadCookies();
      if(leadField) leadField.value = lead.leadId;
      if(firstField) firstField.value = lead.firstContact;
    } else {
      if(leadField) leadField.value = '';
      if(firstField) firstField.value = '';
    }
    if(consentField) consentField.value = choice ? 'Lead-Cookies: ' + (choice.lead ? 'erteilt' : 'abgelehnt') + '; Google Analytics: ' + (choice.analytics ? 'erteilt' : 'abgelehnt') + '; Meta Pixel: ' + (choice.marketing ? 'erteilt' : 'abgelehnt') + '; am ' + choice.at + ' (Version ' + choice.version + ')' : 'Keine Entscheidung';
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
          '<p>Sie entscheiden, welche optionalen Cookies Sie erlauben. Ihre Auswahl speichern wir für sechs Monate. Eine Ablehnung hat keine Nachteile. Änderungen sind jederzeit über „Cookie-Einstellungen“ möglich. <a href="/datenschutz#cookies">Details in der Datenschutzerklärung</a>.</p>' +
          '<fieldset class="pe-cookie-options"><legend>Optionale Zwecke auswählen</legend>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-lead"><span><strong>Lead-Zuordnung</strong><span>Ein zufälliger Lead-Code und Ihr erster Besuchszeitpunkt helfen uns, wiederkehrende Anfragen zuzuordnen und Website-Leads abzurechnen. Speicherdauer: sechs Monate.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-analytics"><span><strong>Statistik mit Google Analytics</strong><span>Google Ireland Limited verarbeitet Nutzungs- und Gerätedaten, damit wir unsere Website verbessern können. Eine Verarbeitung in den USA ist möglich. Analyse-Cookies: bis zu sechs Monate. Keine personalisierte Werbung.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-marketing"><span><strong>Marketing mit Meta Pixel</strong><span>Meta Platforms Ireland Limited erhält Daten zu Seitenaufrufen und Ihrem Browser, um die Wirkung unserer Facebook- und Instagram-Werbung zu messen und Werbung auszuspielen. Eine Verarbeitung in den USA ist möglich. Nur mit Ihrer Zustimmung.</span></span></label>' +
          '</fieldset>' +
        '</div>' +
        '<div class="pe-cookie-actions">' +
          '<button class="pe-cookie-choice" type="button" data-pe-cookie="denied">Nur erforderliche Cookies</button>' +
          '<button class="pe-cookie-choice" type="button" data-pe-cookie="selected">Auswahl speichern</button>' +
          '<button class="pe-cookie-choice" type="button" data-pe-cookie="granted">Alle akzeptieren</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(banner);
    return banner;
  }

  let banner;

  function showBanner(){
    if(!banner) banner = buildBanner();
    const choice = parseChoice();
    banner.querySelector('#pe-consent-lead').checked = !!(choice && choice.lead);
    banner.querySelector('#pe-consent-analytics').checked = !!(choice && choice.analytics);
    banner.querySelector('#pe-consent-marketing').checked = !!(choice && choice.marketing);
    banner.hidden = false;
  }

  function hideBanner(){
    if(banner) banner.hidden = true;
  }

  function saveChoice(status){
    if(!['granted','denied','selected'].includes(status)) return;
    const lead = status === 'granted' || (status === 'selected' && banner.querySelector('#pe-consent-lead').checked);
    const analytics = status === 'granted' || (status === 'selected' && banner.querySelector('#pe-consent-analytics').checked);
    const marketing = status === 'granted' || (status === 'selected' && banner.querySelector('#pe-consent-marketing').checked);
    const now = new Date().toISOString();
    writeCookie(CHOICE_COOKIE, VERSION + '|' + (lead ? 'granted' : 'denied') + '|' + (analytics ? 'granted' : 'denied') + '|' + (marketing ? 'granted' : 'denied') + '|' + now, MAX_AGE);
    if(lead) ensureLeadCookies(pageEnteredAt);
    else clearLeadCookies();
    syncAnalytics(analytics);
    syncMarketing(marketing);
    syncLeadFields();
    hideBanner();
    document.dispatchEvent(new CustomEvent('pe:cookie-choice',{detail:{status:lead ? 'granted' : 'denied',lead:lead,analytics:analytics,marketing:marketing,at:now}}));
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
  } else if(choice.lead){
    ensureLeadCookies();
  } else {
    clearLeadCookies();
  }
  if(choice && choice.needsUpdate) showBanner();
  syncAnalytics(!!(choice && choice.analytics));
  syncMarketing(!!(choice && choice.marketing));
  syncLeadFields();

  window.PaschenCookieConsent = {
    getChoice:parseChoice,
    openSettings:openSettings,
    syncLeadFields:syncLeadFields,
    ensureRequestId:ensureRequestId
  };
})();
