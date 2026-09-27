/* Konfigurator: 4 Schritte + Ergebnis */
(function(){
  const form = document.getElementById('konfForm');
  if(!form) return;
  const card  = document.querySelector('.konf');
  const steps = Array.prototype.slice.call(form.querySelectorAll('.konf-step'));
  const bar   = Array.prototype.slice.call(card.querySelectorAll('.konf-bar i'));
  const submitButton = form.querySelector('button[type="submit"]');
  const submitLabel = submitButton ? submitButton.textContent : 'Unverbindlich anfragen';
  let cur = 0;
  let submitting = false;

  /* Kachel-Auswahl */
  function syncTiles(){
    form.querySelectorAll('.tile input').forEach(function(inp){
      inp.closest('.tile').classList.toggle('sel', inp.checked);
    });
    const gewerbe = form.objekt.value === 'Gewerbe';
    document.getElementById('k-pers-lbl').textContent = gewerbe ? 'Beschäftigte im Betrieb' : 'Personen im Haushalt';
  }
  form.querySelectorAll('.tile input').forEach(function(inp){
    inp.addEventListener('change', syncTiles);
  });
  syncTiles();

  /* Schrittsteuerung */
  function show(i){
    steps.forEach(function(s,n){ s.hidden = n !== i; });
    bar.forEach(function(b,n){ b.className = n < i ? 'done' : (n === i ? 'now' : ''); });
    cur = i;
    if(card.getBoundingClientRect().top < 0) card.scrollIntoView({behavior:'smooth', block:'start'});
    steps[i].focus({preventScroll:true});
  }
  form.addEventListener('click', function(e){
    const next = e.target.closest('[data-next]');
    const back = e.target.closest('[data-back]');
    const again = e.target.closest('[data-restart]');
    if(next){ if(check(cur)) show(cur+1); }
    else if(back){ show(Math.max(0, cur-1)); }
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
  function check(i){
    if(i === 1){
      const plz = document.getElementById('k-plz'), kwh = document.getElementById('k-kwh');
      const okPlz = /^\d{5}$/.test(plz.value.trim());
      const raw = kwh.value.trim().replace(/[.\s']/g,'');
      const okKwh = raw === '' || (/^\d{1,6}$/.test(raw) && +raw > 0);
      mark(plz, !okPlz); mark(kwh, !okKwh);
      if(!okPlz){ setErr('err2','Bitte geben Sie eine 5-stellige Postleitzahl ein.'); plz.focus(); return false; }
      if(!okKwh){ setErr('err2','Bitte den Jahresverbrauch nur als Zahl angeben, z. B. 3200.'); kwh.focus(); return false; }
      setErr('err2',''); return true;
    }
    if(i === 3){
      const nm = document.getElementById('k-name'), ko = document.getElementById('k-kontakt'), cs = document.getElementById('k-consent');
      const val = ko.value.trim();
      const okNm = nm.value.trim().length > 1;
      const okKo = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/.test(val) || /^[+0(][\d\s\/().-]{6,}$/.test(val);
      mark(nm, !okNm); mark(ko, !okKo);
      if(!okNm){ setErr('err4','Bitte nennen Sie mir Ihren Namen.'); nm.focus(); return false; }
      if(!okKo){ setErr('err4','Bitte hinterlassen Sie eine Telefonnummer oder E-Mail-Adresse.'); ko.focus(); return false; }
      if(!cs.checked){ setErr('err4','Bitte bestätigen Sie, dass Sie die Datenschutzerklärung zur Kenntnis genommen haben.'); cs.focus(); return false; }
      setErr('err4',''); return true;
    }
    return true;
  }

  const nf = new Intl.NumberFormat('de-DE');

  function angaben(){
    const eigen = document.getElementById('k-kwh').value.trim().replace(/[.\s']/g,'');
    const beide = document.getElementById('k-beide').checked;
    return {
      sparte: beide ? 'Strom und Gas' : form.sparte.value,
      objekt: form.objekt.value,
      verbrauch: eigen ? nf.format(+eigen) + ' kWh (Ihre Angabe)' : 'Nicht angegeben'
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
      ['Jahresverbrauch', r.verbrauch],
      ['Aktuelle Situation', form.situation.value],
      ['Rückmeldung', document.getElementById('k-zeit').value]
    ];
    if(document.getElementById('k-erhoehung').checked) zeilen.push(['Sonderkündigungsrecht', 'wird mitgeprüft']);
    const anbieter = document.getElementById('k-anbieter').value.trim();
    if(anbieter) zeilen.splice(5, 0, ['Aktueller Anbieter', anbieter]);
    document.getElementById('k-sum').innerHTML = zeilen.map(function(z){
      return '<li><span>' + z[0] + '</span><span>' + z[1].replace(/[<>&]/g,'') + '</span></li>';
    }).join('');
  }

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    if(submitting || !check(3)) return;

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
      show(4);
    } catch(err){
      submitting = false;
      if(submitButton){ submitButton.disabled = false; submitButton.textContent = submitLabel; }
      setErr('err4','Die Anfrage konnte gerade nicht übermittelt werden. Bitte versuchen Sie es erneut oder kontaktieren Sie mich telefonisch.');
    }
  });
})();
