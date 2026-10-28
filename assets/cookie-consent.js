(function(){
  'use strict';

  if(window.PaschenCookieConsent) return;

  const VERSION = '7';
  const MEASUREMENT_ID = 'G-RB9D1EMFDZ';
  const ADS_ID = 'AW-18528448427';
  const ADS_CONVERSION_LABEL = 'Oo2-CN76uaUdEKvfhoNF';
  const ADS_PHONE_LABEL = '6-NtCJzgiKodEKvfhoNF';
  const ADS_PHONE_NUMBER = '0176 16818944';
  const ADS_PHONE_HREF = 'tel:+4917616818944';
  const META_PIXEL_ID = '1853128992346096';
  const CONTENTSQUARE_TAG_ID = '8aa1363a40e89';
  const MAX_AGE = 60 * 60 * 24 * 180;
  const CHOICE_COOKIE = 'pe_cookie_choice';
  const LEAD_COOKIE = 'pe_lead_id';
  const FIRST_CONTACT_COOKIE = 'pe_first_contact';
  const pageEnteredAt = new Date().toISOString();
  let analyticsStarted = false;
  let googleStarted = false;
  let googleReady = false;
  let adsStarted = false;
  let adsConversionSent = false;
  let adsPhoneStarted = false;
  let adsPhoneGeneration = 0;
  let adsPhoneLinks = [];
  let metaStarted = false;
  let metaReady = false;
  let metaPageViewSent = false;
  let contentsquareStarted = false;
  let contentsquareWithdrawn = false;
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
    // Preserve existing choices; Contentsquare always needs its own new opt-in.
    const legacyV2 = parts[0] === '2' && parts.length === 4;
    const legacyV3 = parts[0] === '3' && parts.length === 5;
    const legacyV4 = parts[0] === '4' && parts.length === 5;
    const legacyV5 = parts[0] === '5' && parts.length === 6;
    const legacyV6 = parts[0] === '6' && parts.length === 6;
    const needsAdsUpdate = legacyV2 || legacyV3 || legacyV4 || legacyV5;
    const needsUpdate = needsAdsUpdate || legacyV6;
    if(!needsUpdate && (parts[0] !== VERSION || parts.length !== 7)) return null;
    const purposeEnd = legacyV2 ? 3 : (legacyV3 || legacyV4) ? 4 : (legacyV5 || legacyV6) ? 5 : 6;
    const purposes = parts.slice(1, purposeEnd);
    if(!purposes.every(function(value){ return ['granted','denied'].includes(value); })) return null;
    const at = parts[purposeEnd];
    const timestamp = Date.parse(at);
    if(!Number.isFinite(timestamp) || timestamp > Date.now() || Date.now() - timestamp >= MAX_AGE * 1000) return null;
    return {status:parts[1], lead:parts[1] === 'granted', analytics:parts[2] === 'granted', marketing:!legacyV2 && !legacyV3 && parts[3] === 'granted', ads:!needsAdsUpdate && parts[4] === 'granted', contentsquare:!needsUpdate && parts[5] === 'granted', at:at, version:parts[0], needsUpdate:needsUpdate};
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

  function clearContentsquareData(optOutOnly){
    const matches = function(name){ return optOutOnly ? name === '_cs_optout' : /^_cs_/.test(name) && name !== '_cs_optout'; };
    const names = document.cookie.split(';').map(function(cookie){ return cookie.trim().split('=')[0]; });
    clearCookies(names.filter(matches));
    ['localStorage','sessionStorage'].forEach(function(type){
      try{
        const storage = window[type];
        const keys = [];
        for(let i = 0; i < storage.length; i++) keys.push(storage.key(i));
        keys.filter(matches).forEach(function(key){ storage.removeItem(key); });
      } catch(_error){ /* Storage can be unavailable in restricted browsers. */ }
    });
  }

  function hasContentsquareOptOut(){
    if(readCookie('_cs_optout')) return true;
    return ['localStorage','sessionStorage'].some(function(type){
      try{ return !!window[type].getItem('_cs_optout'); }
      catch(_error){ return false; }
    });
  }

  function syncContentsquare(granted, freshChoice){
    if(!granted){
      if(contentsquareStarted){
        window._uxa.push(['optout']);
        contentsquareWithdrawn = true;
      }
      clearContentsquareData(false);
      return;
    }
    // Clear an opt-out only following a fresh, explicit positive choice.
    if(freshChoice) clearContentsquareData(true);
    // After a withdrawal, a clean initialization happens on the next navigation.
    // Do not reload this page and discard a partially completed form.
    if(contentsquareStarted || hasContentsquareOptOut()) return;
    contentsquareStarted = true;
    window._uxa = window._uxa || [];
    window._uxa.push(['setPIISelectors', {PIISelectors:['input, textarea, select, #k-sum, .konf-result']}]);
    window._uxa.push(['setPath', window.location.pathname]);
    window._uxa.push(['setQuery', '']);
    window._uxa.push(['referrer:removeQueryString']);
    const script = document.createElement('script');
    script.id = 'pe-contentsquare-tag';
    script.async = true;
    script.src = 'https://t.contentsquare.net/uxa/' + CONTENTSQUARE_TAG_ID + '.js';
    script.addEventListener('load', function(){
      const choice = parseChoice();
      if(!choice || !choice.contentsquare) syncContentsquare(false);
      else if(contentsquareWithdrawn) clearContentsquareData(true);
    });
    document.head.appendChild(script);
  }

  function clearAdsCookies(){
    const names = document.cookie.split(';').map(function(cookie){ return cookie.trim().split('=')[0]; });
    clearCookies(names.filter(function(name){ return /^_gcl_/.test(name) || name === 'gwcc'; }));
  }

  function restorePhoneLinks(){
    if(adsPhoneStarted) adsPhoneGeneration++;
    adsPhoneStarted = false;
    adsPhoneLinks.forEach(function(item){
      item.link.setAttribute('href', item.href);
      item.texts.forEach(function(text){ text.node.nodeValue = text.value; });
    });
    adsPhoneLinks = [];
  }

  function configurePhoneTracking(){
    if(adsPhoneStarted) return;
    const numberPattern = /(?:0176|\+49\s*176)\s*16818944/g;
    adsPhoneLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'))
      .filter(function(link){ return link.getAttribute('href') === ADS_PHONE_HREF; })
      .map(function(link){
        const texts = [];
        // Preserve nested markup, icons and CTA labels; only replace actual number text.
        const walker = document.createTreeWalker(link, 4);
        let node;
        while((node = walker.nextNode())){
          if(node.nodeValue.search(numberPattern) !== -1) texts.push({node:node, value:node.nodeValue});
        }
        return {link:link, href:link.getAttribute('href'), texts:texts};
      });
    if(!adsPhoneLinks.length) return;
    adsPhoneStarted = true;
    const generation = ++adsPhoneGeneration;
    window.gtag('config', ADS_ID + '/' + ADS_PHONE_LABEL, {
      phone_conversion_number:ADS_PHONE_NUMBER,
      phone_conversion_options:{cache:false},
      phone_conversion_callback:function(formattedNumber, mobileNumber){
        const choice = parseChoice();
        if(!choice || !choice.ads || generation !== adsPhoneGeneration) return;
        if(typeof formattedNumber !== 'string' || typeof mobileNumber !== 'string' || !/^\+?\d+$/.test(mobileNumber)) return;
        adsPhoneLinks.forEach(function(item){
          item.link.setAttribute('href', 'tel:' + mobileNumber);
          item.texts.forEach(function(text){ text.node.nodeValue = text.value.replace(numberPattern, function(){ return formattedNumber; }); });
        });
      },
      allow_ad_personalization_signals:false,
      allow_enhanced_conversions:false,
      page_location:adsPageLocation(),
      page_referrer:withoutUrlParameters(document.referrer)
    });
  }

  function consentSettings(analytics, ads){
    return {
      analytics_storage:analytics ? 'granted' : 'denied',
      ad_storage:ads ? 'granted' : 'denied',
      ad_user_data:ads ? 'granted' : 'denied',
      ad_personalization:'denied'
    };
  }

  function withoutUrlParameters(value){
    if(!value) return '';
    try{ const url = new URL(value); return url.origin + url.pathname; }
    catch(_error){ return ''; }
  }

  function adsPageLocation(){
    const location = new URL(window.location.href);
    const clean = new URL(location.origin + location.pathname);
    // Preserve attribution identifiers, without forwarding arbitrary query/form values.
    ['gclid','gbraid','wbraid'].forEach(function(name){
      const value = location.searchParams.get(name);
      if(value) clean.searchParams.set(name, value);
    });
    return clean.href;
  }

  function syncGoogle(choice){
    const analytics = !!(choice && choice.analytics);
    const ads = !!(choice && choice.ads);
    window['ga-disable-' + MEASUREMENT_ID] = !analytics;
    if(!analytics) clearAnalyticsCookies();
    if(!ads){
      clearAdsCookies();
      restorePhoneLinks();
    }
    if(googleStarted) window.gtag('consent', 'update', consentSettings(analytics, ads));
    if(!analytics && !ads) return;
    if(!googleStarted){
      googleStarted = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
      window.gtag('consent', 'default', consentSettings(false, false));
      window.gtag('set', 'ads_data_redaction', true);
      window.gtag('set', 'allow_ad_personalization_signals', false);
      window.gtag('consent', 'update', consentSettings(analytics, ads));
      window.gtag('js', new Date());
      // Basic consent mode: one library, loaded only after a relevant opt-in.
      const script = document.createElement('script');
      script.id = 'pe-google-tag';
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + (ads ? ADS_ID : MEASUREMENT_ID);
      script.addEventListener('load', function(){
        googleReady = true;
        // Re-read the saved choice: consent may have been withdrawn while loading.
        syncGoogle(parseChoice());
      });
      document.head.appendChild(script);
    }
    if(!googleReady) return;
    if(analytics && !analyticsStarted){
      analyticsStarted = true;
      window.gtag('config', MEASUREMENT_ID, {
        allow_google_signals:false,
        allow_ad_personalization_signals:false,
        page_location:withoutUrlParameters(window.location.href),
        page_referrer:withoutUrlParameters(document.referrer),
        cookie_expires:MAX_AGE,
        cookie_update:false,
        cookie_flags:'SameSite=Lax;Secure'
      });
    }
    if(ads && !adsStarted){
      adsStarted = true;
      window.gtag('config', ADS_ID, {
        allow_ad_personalization_signals:false,
        allow_enhanced_conversions:false,
        page_location:adsPageLocation(),
        page_referrer:withoutUrlParameters(document.referrer)
      });
    }
    if(ads) configurePhoneTracking();
    if(ads && ADS_CONVERSION_LABEL && !adsConversionSent && /^\/danke(?:\.html)?\/?$/.test(window.location.pathname)){
      adsConversionSent = true;
      window.gtag('event', 'conversion', {
        send_to:ADS_ID + '/' + ADS_CONVERSION_LABEL,
        page_location:withoutUrlParameters(window.location.href),
        page_referrer:withoutUrlParameters(document.referrer)
      });
    }
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
    if(consentField) consentField.value = choice ? 'Lead-Cookies: ' + (choice.lead ? 'erteilt' : 'abgelehnt') + '; Google Analytics: ' + (choice.analytics ? 'erteilt' : 'abgelehnt') + '; Meta Pixel: ' + (choice.marketing ? 'erteilt' : 'abgelehnt') + '; Google Ads: ' + (choice.ads ? 'erteilt' : 'abgelehnt') + '; Contentsquare: ' + (choice.contentsquare ? 'erteilt' : 'abgelehnt') + '; am ' + choice.at + ' (Version ' + choice.version + ')' : 'Keine Entscheidung';
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
          '<h2>Ihre Cookie-Auswahl</h2>' +
          '<p>Paschen Energie: Optionale Cookies für Lead-Zuordnung, Google-Statistik, Contentsquare-Nutzungsanalyse einschließlich Sitzungsaufzeichnungen, Google-Werbe- und Anrufmessung sowie Meta-Werbemessung und personalisierte Werbung. Datenverarbeitung in den USA möglich.</p>' +
          '<p class="pe-cookie-notice">Ablehnen ohne Nachteile; über „Cookie-Einstellungen“ jederzeit änderbar.</p>' +
          '<details class="pe-cookie-disclosure">' +
            '<summary>Einstellungen und Cookie-Details</summary>' +
            '<div class="pe-cookie-disclosure-content">' +
              '<p>Verantwortlicher: Stefanos Paschen Vertrieb &amp; Energie. Sie entscheiden, welche optionalen Cookies Sie erlauben. Ihre Auswahl speichern wir für sechs Monate. <a href="/datenschutz#cookies">Details in der Datenschutzerklärung</a>.</p>' +
          '<fieldset class="pe-cookie-options"><legend>Optionale Zwecke auswählen</legend>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-lead"><span><strong>Lead-Zuordnung</strong><span>Ein zufälliger Lead-Code und Ihr erster Besuchszeitpunkt helfen uns, wiederkehrende Anfragen zuzuordnen und Website-Leads abzurechnen. Speicherdauer: sechs Monate.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-analytics"><span><strong>Statistik mit Google Analytics</strong><span>Google Ireland Limited verarbeitet Nutzungs- und Gerätedaten, damit wir unsere Website verbessern können. Eine Verarbeitung in den USA ist möglich. Analyse-Cookies: bis zu sechs Monate. Keine personalisierte Werbung.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-contentsquare"><span><strong>Nutzungsanalyse mit Contentsquare</strong><span>Contentsquare verarbeitet Klicks, Scrollbewegungen, Seitenaufrufe und technische Gerätedaten zur Verbesserung der Bedienung. Je nach Projekteinstellung werden Sitzungsaufzeichnungen erstellt. Formulareingaben und Ihre Anfrage-Zusammenfassung werden maskiert. Analyse-Kennungen: bis zu 13 Monate. Verarbeitung außerhalb der EU, auch in den USA, möglich. Nur mit Ihrer eigenen Zustimmung.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-marketing"><span><strong>Marketing mit Meta Pixel</strong><span>Meta Platforms Ireland Limited verarbeitet Ihre IP-Adresse, Seitenaufrufe und Browserkennungen zur Werbemessung und für personalisierte Werbung auf Facebook und Instagram. Eine Verknüpfung mit Ihrem Meta-Konto und eine Verarbeitung in den USA sind möglich. Pixel-Cookies: in der Regel 90 Tage, bei weiteren Besuchen erneuerbar. Nur mit Ihrer Zustimmung.</span></span></label>' +
            '<label class="pe-cookie-option"><input type="checkbox" id="pe-consent-ads"><span><strong>Werbemessung mit Google Ads</strong><span>Google Ireland Limited verarbeitet Seitenaufrufe, den Aufruf der Bestätigungsseite, IP-Adresse, Browserdaten und Anzeigenklickkennungen zur Werbemessung. Nach Anzeigenbesuchen kann eine Google-Weiterleitungsnummer Anrufe zuordnen; dabei werden Anrufzeitpunkt, Dauer, Verbindungsstatus und gegebenenfalls die Anrufernummer verarbeitet. Eine Verarbeitung in den USA ist möglich. Cookies zur Anzeigenzuordnung: in der Regel bis zu 90 Tage. Keine personalisierte Werbung durch diese Einbindung. Nur mit Ihrer Zustimmung.</span></span></label>' +
          '</fieldset>' +
          '<p class="pe-cookie-details"><a href="/datenschutz#contentsquare">Details zu Contentsquare</a> · <a href="/datenschutz#google-ads">Details zu Google Ads</a> · <a href="/datenschutz#meta-pixel">Details zu Meta Pixel</a> · <a href="/datenschutz#cookie-widerruf">Einwilligung widerrufen</a></p>' +
            '</div>' +
          '</details>' +
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
    banner.querySelector('#pe-consent-ads').checked = !!(choice && choice.ads);
    banner.querySelector('#pe-consent-contentsquare').checked = !!(choice && choice.contentsquare);
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
    const ads = status === 'granted' || (status === 'selected' && banner.querySelector('#pe-consent-ads').checked);
    const contentsquare = status === 'granted' || (status === 'selected' && banner.querySelector('#pe-consent-contentsquare').checked);
    const now = new Date().toISOString();
    writeCookie(CHOICE_COOKIE, VERSION + '|' + (lead ? 'granted' : 'denied') + '|' + (analytics ? 'granted' : 'denied') + '|' + (marketing ? 'granted' : 'denied') + '|' + (ads ? 'granted' : 'denied') + '|' + (contentsquare ? 'granted' : 'denied') + '|' + now, MAX_AGE);
    if(lead) ensureLeadCookies(pageEnteredAt);
    else clearLeadCookies();
    syncGoogle(parseChoice());
    syncMarketing(marketing);
    syncContentsquare(contentsquare, contentsquare);
    syncLeadFields();
    hideBanner();
    document.dispatchEvent(new CustomEvent('pe:cookie-choice',{detail:{status:lead ? 'granted' : 'denied',lead:lead,analytics:analytics,marketing:marketing,ads:ads,contentsquare:contentsquare,at:now}}));
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
  syncGoogle(choice);
  syncMarketing(!!(choice && choice.marketing));
  syncContentsquare(!!(choice && choice.contentsquare));
  syncLeadFields();

  window.PaschenCookieConsent = {
    getChoice:parseChoice,
    openSettings:openSettings,
    syncLeadFields:syncLeadFields,
    ensureRequestId:ensureRequestId
  };
})();

