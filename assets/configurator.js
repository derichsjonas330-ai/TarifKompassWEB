/* Konfigurator: 2 Schritte, anschließend Versandbestätigung */
(function(){
  const form = document.getElementById('konfForm');
  if(!form) return;
  const card  = document.querySelector('.konf');
  const steps = Array.prototype.slice.call(form.querySelectorAll('.konf-step'));
  const bar   = Array.prototype.slice.call(card.querySelectorAll('.konf-bar i'));
  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton ? submitButton.textContent : 'Sparangebot kostenlos anfordern';
  let cur = 0;
  let submitting = false;

  /* Kachel-Auswahl */
  function syncTiles(){
    form.querySelectorAll('.tile input').forEach(function(inp){
      inp.closest('.tile').classList.toggle('sel', inp.checked);
    });
    syncConsumption();
  }
  form.querySelectorAll('.tile input').forEach(function(inp){
    inp.addEventListener('change', syncTiles);
  });
  syncTiles();

  function syncConsumption(){
    const unknown = document.getElementById('k-unbekannt').checked;
    const both = document.getElementById('k-beide').checked;
    const sparte = form.sparte.value;
    const kwh = document.getElementById('k-kwh');
    const household = unknown && form.objekt.value !== 'Gewerbe' && sparte === 'Strom';
    kwh.disabled = unknown;
    kwh.required = !unknown;
    document.getElementById('k-pers-field').hidden = !household;
    document.getElementById('k-pers').disabled = !household;
    document.getElementById('k-kwh-lbl').textContent = (sparte === 'Gas' ? 'Gasverbrauch' : sparte === 'Heizstrom' ? 'Heizstromverbrauch' : 'Stromverbrauch') + ' pro Jahr (kWh)';
    kwh.placeholder = sparte === 'Gas' ? 'z. B. 12000' : sparte === 'Heizstrom' ? 'z. B. 5000' : 'z. B. 3200';
    document.getElementById('k-verbrauch-hint').textContent = (unknown
      ? 'Den genauen Verbrauch klären wir persönlich. Ihre Anfrage ist auch ohne Abrechnung möglich.'
      : 'Den Jahresverbrauch finden Sie auf Ihrer letzten Abrechnung.')
      + (both ? ' Die Abrechnung der zweiten Sparte können Sie später nachreichen.' : '');
    mark(kwh, false);
    setErr('err2', '');
  }
  document.getElementById('k-unbekannt').addEventListener('change', syncConsumption);
  document.getElementById('k-beide').addEventListener('change', function(){
    // "Strom und Gas" must never silently replace a heat-pump request.
    if(document.getElementById('k-beide').checked && form.sparte.value === 'Heizstrom'){
      form.querySelector('input[name="sparte"][value="Strom"]').checked = true;
    }
    syncTiles();
  });
  form.querySelector('input[name="sparte"][value="Heizstrom"]').addEventListener('change', function(){
    if(form.sparte.value === 'Heizstrom') document.getElementById('k-beide').checked = false;
    syncConsumption();
  });

  /* Schrittsteuerung */
  function showIntroduction(){
    window.scrollTo({top:0, left:0, behavior:'instant'});
  }
  function show(i){
    steps.forEach(function(s,n){ s.hidden = n !== i; });
    bar.forEach(function(b,n){ b.className = n < i ? 'done' : (n === i ? 'now' : ''); });
    cur = i;
    steps[i].focus({preventScroll:true});
    showIntroduction();
  }
  // Entry links return to the same complete view and keep previously entered data.
  document.addEventListener('click', function(e){
    if(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if(!link || link.hasAttribute('download') || (link.getAttribute('target') && link.getAttribute('target') !== '_self')) return;
    const target = new URL(link.href, window.location.href);
    if(target.origin !== window.location.origin || target.pathname !== window.location.pathname || target.search !== window.location.search || target.hash !== '#analyse') return;
    if(submitting){ e.preventDefault(); return; }
    e.preventDefault();
    clearErr();
    show(0);
  });
  form.addEventListener('click', function(e){
    const next = e.target.closest('[data-next]');
    const back = e.target.closest('[data-back]');
    const again = e.target.closest('[data-restart]');
    if(submitting) return;
    if(next){ if(check(cur)) show(cur+1); }
    else if(back){ clearErr(); show(Math.max(0, cur-1)); }
    else if(again){
      form.reset(); syncTiles(); clearErr(); submitting = false;
      if(submitButton){ submitButton.disabled = false; submitButton.textContent = submitLabel; }
      show(0);
    }
  });

  /* Prüfung */
  function setErr(id, msg){
    const el = document.getElementById(id);
    if(!el) return;
    el.textContent = msg || '';
    el.classList.toggle('on', !!msg);
  }
  function clearErr(){
    setErr('err2',''); setErr('err4','');
    form.querySelectorAll('.field.bad').forEach(function(f){ f.classList.remove('bad'); });
  }
  function mark(el, bad){
    const f = el.closest('.field');
    if(f) f.classList.toggle('bad', bad);
  }
  function focusError(el){
    el.focus({preventScroll:true});
    showIntroduction();
  }
  function check(i){
    if(i === 0){
      const plz = document.getElementById('k-plz'), kwh = document.getElementById('k-kwh');
      const okPlz = /^\d{5}$/.test(plz.value.trim());
      const raw = kwh.value.trim().replace(/[.\s']/g,'');
      const okKwh = document.getElementById('k-unbekannt').checked || (/^\d{1,6}$/.test(raw) && +raw > 0);
      mark(plz, !okPlz); mark(kwh, !okKwh);
      if(!okPlz){ setErr('err2','Bitte geben Sie eine 5-stellige Postleitzahl ein.'); focusError(plz); return false; }
      if(!okKwh){ setErr('err2','Bitte geben Sie Ihren Jahresverbrauch ein, z. B. 3200, oder wählen Sie „Jahresverbrauch gerade nicht zur Hand“.'); focusError(kwh); return false; }
      setErr('err2',''); return true;
    }
    if(i === 1){
      const nm = document.getElementById('k-name'), tel = document.getElementById('k-telefon'), email = document.getElementById('k-email'), cs = document.getElementById('k-consent');
      const phoneValue = tel.value.trim(), emailValue = email.value.trim();
      const okNm = nm.value.trim().length > 1;
      const okTel = phoneValue.length <= 100 && /^[+0(][\d\s\/().-]{6,}$/.test(phoneValue)
        && phoneValue.replace(/\D/g,'').length >= 7;
      const okEmail = emailValue === '' || /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(emailValue);
      mark(nm, !okNm); mark(tel, !okTel); mark(email, !okEmail);
      if(!okNm){ setErr('err4','Bitte nennen Sie mir Ihren Namen.'); focusError(nm); return false; }
      if(!phoneValue){ setErr('err4','Bitte geben Sie Ihre Telefonnummer an. Sie ist für die persönliche Rückmeldung erforderlich.'); focusError(tel); return false; }
      if(!okTel){ setErr('err4','Bitte geben Sie eine gültige Telefonnummer ein.'); focusError(tel); return false; }
      if(!okEmail){ setErr('err4','Bitte geben Sie eine gültige E-Mail-Adresse ein.'); focusError(email); return false; }
      if(!cs.checked){ setErr('err4','Bitte bestätigen Sie, dass Sie die Datenschutzerklärung zur Kenntnis genommen haben.'); focusError(cs); return false; }
      setErr('err4',''); return true;
    }
    return true;
  }

  const nf = new Intl.NumberFormat('de-DE');

  function angaben(){
    const eigen = document.getElementById('k-unbekannt').checked ? '' : document.getElementById('k-kwh').value.trim().replace(/[.\s']/g,'');
    const beide = document.getElementById('k-beide').checked;
    return {
      sparte: beide ? 'Strom und Gas' : form.sparte.value,
      objekt: form.objekt.value,
      verbrauch: eigen ? nf.format(+eigen) + ' kWh ' + form.sparte.value + ' (Ihre Angabe)' : 'Nicht bekannt, persönlich klären'
    };
  }

  function ergebnis(){
    const r = angaben();
    document.getElementById('k-est').textContent = 'In Prüfung';
    document.getElementById('k-verbrauch-berechnet').value = r.verbrauch;
    document.getElementById('k-sparpotenzial').value = 'Noch nicht ermittelt';
    const zeilen = [
      ['Sparte', r.sparte === 'Heizstrom' ? 'Heizstrom (Wärmepumpe)' : r.sparte],
      ['Objekt', r.objekt],
      ['Postleitzahl', document.getElementById('k-plz').value.trim()],
      ['Jahresverbrauch', r.verbrauch]
    ];
    const personen = document.getElementById('k-pers');
    if(!personen.disabled && personen.value) zeilen.push(['Personen im Haushalt', personen.value === '5' ? '5 oder mehr' : personen.value]);
    document.getElementById('k-sum').innerHTML = zeilen.map(function(z){
      return '<li><span>' + z[0] + '</span><span>' + z[1].replace(/[<>&]/g,'') + '</span></li>';
    }).join('');
  }

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    if(submitting) return;
    // Enter on the first screen advances to contact instead of sending early.
    if(cur === 0){ if(check(0)) show(1); return; }
    if(cur !== 1) return;
    if(!check(0)){ show(0); return; }
    if(!check(1)) return;

    // Keep the original contact field available for existing form notifications.
    document.getElementById('k-kontakt').value = [
      document.getElementById('k-telefon').value.trim(),
      document.getElementById('k-email').value.trim()
    ].filter(Boolean).join(' / ');

    if(window.PaschenCookieConsent){
      window.PaschenCookieConsent.syncLeadFields(form);
      window.PaschenCookieConsent.ensureRequestId(form);
    }
    ergebnis();
    submitting = true;
    setErr('err4','');
    if(submitButton){ submitButton.disabled = true; submitButton.textContent = 'Anfrage wird gesendet …'; }

    try{
      const response = await fetch('/', {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams(new FormData(form)).toString()
      });
      if(!response.ok) throw new Error('Übermittlung fehlgeschlagen: ' + response.status);
      show(2);
      // Keep the confirmation visible while the success page loads.
      window.location.assign(form.getAttribute('action') || '/danke');
    } catch(err){
      submitting = false;
      if(submitButton){ submitButton.disabled = false; submitButton.textContent = submitLabel; }
      setErr('err4','Die Anfrage konnte gerade nicht übermittelt werden. Bitte versuchen Sie es erneut oder kontaktieren Sie mich telefonisch.');
    }
  });
})();
