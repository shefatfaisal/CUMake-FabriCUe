// Classic script: intentionally uses the original HTML app's state and render hooks.
// Clothing profiles sync to Firebase; the open app processes scans and saves the results.
(() => {
  let data = {connected: false, loaded: false, scans: [], tags: [], error: ''};
  const formatTime = value => new Date(value).toLocaleString();
  const owner = tagId => s.clothes.find(item => item.rfid === tagId);
  const connectionText = () => data.error || (!data.connected
    ? data.loaded ? 'OFFLINE · SHOWING SAVED SCANS' : 'CONNECTING TO FIREBASE…'
    : data.loaded ? 'LIVE · FIREBASE /scans' : 'CONNECTED · LOADING SCANS…');

  function paintScanner() {
    app.innerHTML = title('YOUR SCANNER')
      + sheet(esc(connectionText()), `${data.tags.length} unique tags · ${data.scans.length} stored scan events`, data.connected && !data.error ? 'lime' : 'yellow')
      + '<p class="sub">Scans come from ESP32 → Firebase. Link a detected tag using Add Clothing. Clothing profiles and wear counts sync with Firebase. Plans and timers stay on this device.</p>'
      + '<button class="btn primary" style="width:100%" onclick="add()">+ LINK A TAG TO CLOTHING</button>'
      + '<h3 style="margin-top:22px">ESP32 INDICATOR</h3>'
      + '<p class="sub">Automatic: a = green, b = yellow, c = red. Test d for flashing red; check your selected laundry load before starting the wash.</p>'
      + '<div class="actions">' + ['a','b','c','d'].map(value => `<button class="btn" onclick="window.laundryCloud.testIndicator(\'${value}\')">TEST ${value.toUpperCase()}</button>`).join('') + '</div>'
      + '<h3 style="margin-top:22px">DETECTED TAGS</h3>'
      + (data.tags.map(tag => {
        const clothing = owner(tag.tagId);
        return `<div class="sheet white"><h3 style="overflow-wrap:anywhere">${esc(clothing?.name || 'UNLINKED TAG')}</h3><p style="overflow-wrap:anywhere">${esc(tag.tagId)}</p><p>${tag.count} detections · last seen ${esc(formatTime(tag.lastSeen))}</p><p class="sub">${clothing ? 'Linked to your clothing profile' : 'Available to link from Add Clothing'}</p></div>`;
      }).join('') || `<p class="sub">${data.loaded ? 'No scans stored yet. Scan a tag using your ESP32.' : 'Waiting for Firebase scan data…'}</p>`)
      + '<h3 style="margin-top:22px">RECENT SCANS</h3>'
      + data.scans.slice(0, 20).map(scan => `<div class="log" style="overflow-wrap:anywhere">${esc(scan.tagId)}<br><small>${esc(formatTime(scan.receivedAt))}</small></div>`).join('')
      + '<p class="sub">Demo mode: each new scan uses one wear allowance. Keep this app open for immediate processing.</p>'
      + '<a class="btn" style="display:block;text-align:center" href="/">VIEW FULL RFID HISTORY ↗</a>';
  }

  // A check belongs to one local load. Its baseline survives reloads; history never
  // satisfies a new check. Starting again clears unexpected detections as well.
  function checkResult() {
    const check = s.load?.rfidCheck;
    const tags = new Set(check?.tags || []);
    const expected = s.clothes.filter(item => s.load?.ids.includes(item.id));
    return {
      present: expected.filter(item => item.rfid && tags.has(item.rfid)),
      missing: expected.filter(item => !item.rfid || !tags.has(item.rfid)),
      unexpected: [...tags].filter(tag => !expected.some(item => item.rfid === tag))
    };
  }
  window.startLaundryCheck = function() {
    if (s.load?.stage !== 'ready') return;
    if (!ready()) return toast('Wait for the live Firebase connection before checking clothes.');
    s.load.rfidCheck = {startedAt: Date.now() + (data.serverTimeOffset || 0),
      baseline: data.scans.map(scan => scan.id), tags: []};
    save(); paintLaundryPanel();
  };
  let finishingCheck = false;
  window.finishLaundryCheck = async function() {
    if (finishingCheck) return;
    if (s.load?.stage !== 'ready' || !s.load.rfidCheck) return toast('Start an RFID check first.');
    if (!ready() || !window.laundryCloud?.finishLaundryCheck) return toast('Wait for the live Firebase connection before finishing the check.');
    const result = checkResult();
    if (result.missing.length || result.unexpected.length) {
      const card = item => {
        const photo = typeof item.photo === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/.test(item.photo)
          ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" style="width:100%;height:100%;object-fit:cover">`
          : '<span aria-label="No photo" style="font-size:32px">👕</span>';
        return `<div class="sheet white" style="display:flex;align-items:center;gap:16px"><div style="width:80px;height:80px;flex-shrink:0;display:grid;place-items:center;background:#eee;border-radius:12px;overflow:hidden">${photo}</div><div><h3>${esc(item.name)}</h3><p>${item.rfid ? 'Not detected in this load' : 'No linked RFID tag'}</p></div></div>`;
      };
      topModal(result.missing.length ? 'MISSING CLOTHES' : 'CHECK YOUR LOAD',
        `<p>${result.missing.length} selected item(s) not detected. Find these clothes and scan their tags, then finish checking again.</p>`
        + result.missing.map(card).join('')
        + (result.unexpected.length ? '<h3>UNEXPECTED TAGS</h3><p>Remove these pieces, restart the check, and rescan your selected clothes.</p>'
          + result.unexpected.map(tag => `<p style="overflow-wrap:anywhere">${esc(owner(tag)?.name || 'Unlinked tag')} · ${esc(tag)}</p>`).join('') : '')
        + '<p id="laundry-result-signal" role="status">Sending flashing red signal to ESP32…</p><button class="btn primary" onclick="closeModal()">BACK TO LOAD</button>');
    }
    finishingCheck = true;
    try {
      const value = await window.laundryCloud.finishLaundryCheck([...s.load.ids], [...s.load.rfidCheck.tags]);
      const status = document.getElementById('laundry-result-signal');
      if (status) status.textContent = value === 'd' ? 'Flashing red signal sent. See the cloud banner for ESP32 confirmation.' : 'Green signal sent. See the cloud banner for ESP32 confirmation.';
      toast(value === 'a' ? 'Load matches. Green signal sent to ESP32.' : 'Missing or unexpected clothes. Flashing red signal sent to ESP32.');
    } catch (failure) {
      const status = document.getElementById('laundry-result-signal');
      if (status) status.textContent = 'Signal was not confirmed sent: ' + failure.message;
      toast('Could not send laundry result: ' + failure.message);
    }
    finally { finishingCheck = false; }
  };
  function updateLaundryCheck() {
    const check = s.load?.stage === 'ready' && s.load.rfidCheck;
    if (!check || !ready()) return;
    const baseline = new Set(check.baseline || []);
    const tags = new Set(check.tags || []);
    for (const scan of data.scans) {
      if (!baseline.has(scan.id) && scan.receivedAt >= check.startedAt) tags.add(scan.tagId);
    }
    if (tags.size !== (check.tags || []).length) {
      check.tags = [...tags]; save(); paintLaundryPanel();
    }
  }
  if (typeof paintLaundryPanel === 'function') {
    const originalPanel = paintLaundryPanel;
    paintLaundryPanel = function() {
      originalPanel();
      if (s.load?.stage !== 'ready') return;
      const el = ensurePanel();
      const result = checkResult();
      const rows = (label, values) => `<p><strong>${label} (${values.length})</strong><br>${values.map(value => esc(typeof value === 'string' ? (owner(value)?.name || 'Unlinked tag') + ' · ' + value : value.name + (!value.rfid ? ' · No linked tag' : ''))).join('<br>') || 'None'}</p>`;
      el.insertAdjacentHTML('beforeend', `<div class="laundry-check" role="status"><h3>CHECK YOUR LOAD</h3>
        <p>Scan each selected piece before washing. Remove a tag from range and bring it back to trigger a fresh scan. Keep this app open.</p>
        ${!s.load.rfidCheck ? '<p>Start a check to ignore previous scans.</p>' : rows('PRESENT', result.present) + rows('MISSING / NOT YET SCANNED', result.missing) + rows('UNEXPECTED', result.unexpected)}
        <button class="panel-btn" onclick="startLaundryCheck()">${s.load.rfidCheck ? 'RESTART CHECK' : 'START RFID CHECK'}</button>
        ${s.load.rfidCheck ? '<button class="panel-btn" onclick="finishLaundryCheck()">FINISH CHECKING</button><p>Finish checking sends green for a matching load, or flashing red for missing or unexpected clothes.</p>' : ''}
        ${result.unexpected.length ? '<p>Remove unexpected clothes, then restart and rescan the load.</p>' : ''}
        <p>${esc(connectionText())}</p></div>`);
    };
    const originalLaunch = launchTimer;
    launchTimer = function(event, stage) {
      if (stage === 'wash') {
        const result = checkResult();
        if (!ready() || !s.load?.rfidCheck || result.missing.length || result.unexpected.length) {
          event?.preventDefault();
          return toast('Scan every selected item and resolve unexpected tags before starting the wash.');
        }
      }
      return originalLaunch(event, stage);
    };
  }

  // Bedroom scans verify returns separately from the pre-wash scan baseline.
  window.startBedroomCheck = function() {
    if (s.load?.stage !== 'return' || !ready()) return toast('Wait for the live connection and drying to finish.');
    s.load.bedroomCheck = {startedAt: Date.now() + (data.serverTimeOffset || 0),
      baseline: data.scans.map(scan => scan.id), tags: []};
    save(); paintLaundryPanel();
  };
  function bedroomMissing() {
    const tags = new Set(s.load?.bedroomCheck?.tags || []);
    return (s.load?.ids || []).filter(id => {
      const item = s.clothes.find(item => item.id === id);
      return !item?.rfid || !tags.has(item.rfid);
    });
  }
  let completingBedroom = false;
  window.finishBedroomCheck = async function() {
    if (completingBedroom) return;
    if (s.load?.stage !== 'return' || !s.load.bedroomCheck) return toast('Start the bedroom RFID check first.');
    const missing = bedroomMissing();
    if (!missing.length) {
      if (!ready() || !window.laundryCloud?.finishBedroomReturn) return toast('Wait for the live Firebase connection.');
      const load = s.load;
      completingBedroom = true;
      try {
        await window.laundryCloud.finishBedroomReturn([...load.ids], [...load.bedroomCheck.tags]);
        if (s.load !== load) return;
        s.load = null;
        save(); render();
        toast('All clothes returned! Full wear allowance restored for this load.');
      } catch (failure) { toast('Could not complete return: ' + failure.message); }
      finally { completingBedroom = false; }
      return;
    }
    topModal(missing.length ? 'MISSING CLOTHES' : 'ALL CLOTHES RETURNED',
      (missing.length ? '<p>Not returned to bedroom. Bring these clothes back and scan each tag before confirming return.</p>' : '<p>Every item in this load was detected in your bedroom.</p>')
      + missing.map(id => {
        const item = s.clothes.find(item => item.id === id);
        const photo = typeof item?.photo === 'string' && /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(item.photo)
          ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" style="width:80px;height:80px;object-fit:cover;border-radius:12px">`
          : '<span aria-label="No photo">👕</span>';
        return `<div class="sheet white">${photo}<h3>${esc(item?.name || 'Clothing')}</h3><p>Not returned to bedroom</p></div>`;
      }).join('') + '<button class="btn primary" onclick="closeModal()">BACK TO LOAD</button>');
  };
  function updateBedroomCheck() {
    const check = s.load?.stage === 'return' && s.load.bedroomCheck;
    if (!check || !ready()) return;
    const tags = new Set(check.tags);
    const baseline = new Set(check.baseline);
    for (const scan of data.scans) {
      if (!baseline.has(scan.id) && scan.receivedAt >= check.startedAt) tags.add(scan.tagId);
    }
    if (tags.size !== check.tags.length) { check.tags = [...tags]; save(); paintLaundryPanel(); }
  }
  const beforeBedroomPanel = paintLaundryPanel;
  paintLaundryPanel = function() {
    if (s.load?.stage !== 'return') return beforeBedroomPanel();
    const missing = bedroomMissing();
    ensurePanel().innerHTML = `<h3>DRYING IS DONE · BEDROOM RETURN CHECK</h3>
      <p>Bring your clothes past the bedroom RFID reader. Keep the app open. Remove tags from range and bring them back for a fresh scan.</p>
      <p>${s.load.ids.length - missing.length} / ${s.load.ids.length} items detected in bedroom</p>
      <button class="panel-btn" onclick="startBedroomCheck()">${s.load.bedroomCheck ? 'RESTART' : 'START'} BEDROOM CHECK</button>
      ${s.load.bedroomCheck ? `<button class="panel-btn" onclick="finishBedroomCheck()">${missing.length ? 'CHECK MISSING CLOTHES' : 'CONFIRM RETURN'}</button>${missing.length ? '<button class="panel-btn" disabled>CONFIRM RETURN</button><p>Bring back and scan the missing clothes first.</p>' : '<p>All clothes scanned. Confirm return to complete this load.</p>'}` : ''}
      <p>Scan every item, then confirm return to restore this load’s full wear allowance.</p>
      <p>${esc(connectionText())}</p>`;
  };

  let applyingCloud = false;
  let localLoadIds = new Set(s.load?.ids || []);
  const localSave = save;
  save = function() {
    if (!applyingCloud) {
      const ids = new Set(s.load?.ids || []);
      for (const clothing of s.clothes) {
        if (ids.has(clothing.id)) clothing.inLaundry = true;
        else if (localLoadIds.has(clothing.id)) clothing.inLaundry = false;
      }
      localLoadIds = ids;
    }
    localSave();
    if (!applyingCloud) window.laundryCloud?.save(s.clothes, s.load);
  };
  let cloudState = {ready: false, connected: false, pending: 0, error: ''};
  function cloudStatus(value) {
    cloudState = value;
    let banner = document.getElementById('closet-cloud-status');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'closet-cloud-status';
      banner.className = 'sub';
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'padding:12px 18px;background:#e8e5fa;color:#24232d;overflow-wrap:anywhere';
      document.getElementById('phone').insertBefore(banner, app);
    }
    const text = value.error ? 'Cloud sync: ' + value.error
      : !value.ready ? 'Connecting clothing profiles to Firebase…'
      : !value.connected ? 'Offline · changes stay on this device until reconnected.'
      : value.pending ? 'Saving clothing changes to Firebase…'
      : 'Saved in Firebase · demo processing active · ' + value.timezone;
    banner.textContent = text;
    if (value.output) {
      const names = {a:'GREEN', b:'YELLOW', c:'RED', d:'FLASHING RED'};
      const confirmed = value.acknowledgement?.commandId === value.output.commandId
        && value.acknowledgement?.value === value.output.value;
      const result = document.createElement('p');
      result.textContent = `ESP32 signal: ${value.output.value} · ${names[value.output.value]} · ${confirmed ? 'Device confirmed' : 'Waiting for ESP32 acknowledgement'}`;
      banner.append(result);
    }
    if (value.error) {
      const retry = document.createElement('button');
      retry.textContent = 'RETRY SYNC';
      retry.addEventListener('click', () => window.laundryCloud?.retry());
      banner.append(retry);
    }
    updateEnrollment();
  }
  let enrollment = null;
  function ready() { return data.connected && data.loaded && !data.error && (!window.laundryCloud || window.laundryCloud.ready); }
  function arm() {
    enrollment.startedAt = Date.now() + (data.serverTimeOffset || 0);
    enrollment.seen = new Set(data.scans.map(scan => scan.id));
  }
  function updateEnrollment() {
    const status = document.getElementById('tag-connection');
    if (status) status.textContent = window.laundryCloud && !cloudState.ready
      ? 'Waiting for clothing cloud sync. ' + (cloudState.error || '') : connectionText();
    if (!enrollment || !pendingItem || enrollment.item !== pendingItem || !modal.open) return;
    if (!ready()) return;
    if (!enrollment.seen) { arm(); return; }
    const fresh = data.scans.filter(scan => !enrollment.seen.has(scan.id)
      && scan.receivedAt >= enrollment.startedAt);
    data.scans.forEach(scan => enrollment.seen.add(scan.id));
    const candidates = [...new Set(fresh.map(scan => scan.tagId))];
    const error = document.getElementById('rfid-error');
    if (candidates.length > 1) {
      if (error) error.textContent = 'Several tags were detected. Remove them, then scan only the new clothing tag again.';
      return;
    }
    if (!candidates.length) return;
    const tagId = candidates[0];
    const clothing = owner(tagId);
    if (clothing) {
      if (error) error.textContent = 'This tag is already linked to ' + clothing.name + '. Scan an unused tag.';
      return;
    }
    enrollment = null;
    finishTagSetup(tagId);
  }

  const originalRender = render;
  render = function() {
    originalRender();
    if (page === 'Scanner') paintScanner();
    if (page === 'Settings') app.insertAdjacentHTML('afterbegin', '<p class="sub">Clothing profiles, photos, and wear counts sync with Firebase. Plans and timers remain local.</p>');
    if (page === 'Home' && !document.getElementById('live-scanner-link')) {
      app.insertAdjacentHTML('beforeend', '<button id="live-scanner-link" class="btn primary" style="width:100%;margin-top:16px" onclick="go(\'Scanner\')">LIVE RFID SCANNER ↗</button>');
    }
  };

  const originalAdd = add;
  add = function() {
    enrollment = null;
    originalAdd();
    const button = document.getElementById('next-tag');
    if (button) button.textContent = 'NEXT: SCAN RFID TAG ➜';
  };
  tagView = function() {
    if (!pendingItem) return;
    enrollment = {item: pendingItem, seen: null, startedAt: null};
    if (ready()) arm();
    topModal('SCAN CLOTHING TAG', sheet('WAITING FOR YOUR READER', esc(pendingItem.name), 'purple')
      + '<p id="tag-connection" class="sub" role="status"></p>'
      + '<p>Bring only this clothing tag near the RFID reader. The next new scan will automatically link the tag and save this clothing.</p>'
      + '<p class="sub">Wait until Firebase is live before scanning. Previously saved scans are ignored. If the tag is already in range, remove it and bring it back to trigger a new scan.</p>'
      + '<div id="rfid-error" role="alert"></div>'
      + '<button class="flat" onclick="cancelTagSetup()">CANCEL</button>');
    updateEnrollment();
  };
  const originalCancel = cancelTagSetup;
  cancelTagSetup = function() { enrollment = null; originalCancel(); };
  modal.addEventListener('close', () => { enrollment = null; });

  const originalCard = closetCard;
  closetCard = function(clothing) {
    return originalCard(clothing).replace(`${clothing.wears} / ${clothing.limit} wears used`, `${Math.max(0, clothing.limit - clothing.wears)} / ${clothing.limit} wears remaining`);
  };
  const originalDetail = detail;
  detail = function(id) {
    originalDetail(id);
    modal.innerHTML = modal.innerHTML.replace('MARK WORN TODAY', 'USE ONE WEAR (DEMO)');
    const clothing = s.clothes.find(item => item.id === id);
    if (!clothing) return;
    const tag = data.tags.find(item => item.tagId === clothing.rfid);
    modal.insertAdjacentHTML('beforeend', `<p class="sub"><strong>${Math.max(0, clothing.limit - clothing.wears)} / ${clothing.limit} wears remaining</strong></p><p class="sub" style="overflow-wrap:anywhere">Firebase RFID: ${esc(clothing.rfid || 'Not linked')}<br>${tag ? 'Last detected: ' + esc(formatTime(tag.lastSeen)) : 'No matching scan loaded.'}</p>`);
  };

  // Reopening a closet never consumes old raw scans or changes its wear counts.
  window.laundryRfid = {
    resetForConnection(id) {
      const key = 'smart-laundry-connection-id';
      if (localStorage.getItem(key) === id) return;
      window.laundryCloud?.pauseForReset();
      applyingCloud = true;
      try {
        s = defaults(); pendingItem = null; tagFlow = null; enrollment = null;
        localLoadIds = new Set(); reviewSkipped = []; skippedReviewIds = null;
        panelEntry = ''; showReturnItems = false; restoreCandidate = null;
        chosen = s.date; month = dt(s.date); query = ''; filter = 'All';
        localStorage.removeItem('smart-laundry-cloud-pending-v1');
        window.smartLaundryGoogleCalendar?.clearSession?.();
        localStorage.setItem(key, id);
        save(); if (modal.open) modal.close();
        window.location.reload();
      } finally { applyingCloud = false; }
    },
    showCommunicationError(message) {
      let banner = document.getElementById('connection-handshake-status');
      if (!banner && message) {
        banner = document.createElement('p'); banner.id = 'connection-handshake-status';
        banner.className = 'sub'; banner.setAttribute('role','status');
        banner.style.cssText = 'padding:12px 18px;background:#fff0cc;color:#24232d;overflow-wrap:anywhere';
        document.getElementById('phone').insertBefore(banner,app);
      }
      if (banner) {banner.textContent = message; banner.hidden = !message;}
    },
    getLocalClothes() { return JSON.parse(JSON.stringify(s.clothes)); },
    notify(message) { toast(message); },
    cloudStatus,
    applyCloudClothes(clothes) {
      applyingCloud = true;
      try { s.clothes = clothes; save(); render(); } finally { applyingCloud = false; }
    },
    update(next) {
    data = next;
    if (page === 'Scanner') paintScanner();
    updateEnrollment();
    updateLaundryCheck();
    updateBedroomCheck();
  }};
  markWornToday = function(id) { window.laundryCloud?.manualWear(id); };
  // Tracking changes go through app transactions; legacy local controls must not overwrite it.
  const localEdit = editClothing;
  editClothing = function(id) {
    localEdit(id);
    for (const field of ['edit-usage', 'edit-washes', 'edit-dates']) {
      const input = document.getElementById(field);
      if (input) { input.readOnly = true; input.title = 'Wear history is maintained by app scan processing.'; }
    }
  };
  washed = returnScan = returnAll = finishLoad = function() {
    toast('Use the laundry panel: RFID check before washing, then bedroom return check after drying to restore wear counts in Firebase.');
  };
  render();
  import('./laundry-firebase.js?v=8').catch(() => {
    data.error = 'Could not load Firebase. Check your connection, then reload the app.';
    if (page === 'Scanner') paintScanner();
    updateEnrollment();
  });
  import('./schedule-auto.js?v=1').catch(() => {
    console.warn('AUTO Google Calendar scheduling module failed to load; wardrobe-only HTML helpers remain.');
  });
})();
