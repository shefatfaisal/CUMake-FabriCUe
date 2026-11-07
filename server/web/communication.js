// A fresh firmware connectionId is required: repeated "success" is not a new event.
export function startCommunication(database, {ref, onValue, runTransaction, update}, reportError, lifecycle = {}) {
  let request = null, connectionId = null, session = null, working = false, stopped = false;
  const loaded = new Set();
  async function respond() {
    if (working || stopped || loaded.size !== 3 || request !== 'success') return;
    if (!connectionId) return reportError('ESP32 must send a new /status/connectionId for each connection before requesting success.');
    if (session?.connectionId === connectionId && session.phase === 'ready') return;
    working = true;
    const id = connectionId;
    let step = 'claiming the connection';
    try {
      const claimed = await runTransaction(ref(database, 'status/session'), current => {
        if (current?.connectionId === id) return current;
        return {connectionId: id, phase: 'resetting'};
      }, {applyLocally: false});
      const state = claimed.snapshot.val();
      if (state?.connectionId !== id || state.phase !== 'resetting') return;
      lifecycle.pause?.();
      step = 'clearing the previous data';
      // Atomic: no successful reply can be observed before the data is cleared.
      await update(ref(database), {
        scans: null, clothingPhotos: null, signal: null, acknowledgement: null,
        users: null, scanResults: null, closetRequests: null, closetResults: null,
        closet: {settings: {processing: 'app', mode: 'demo', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', connectionId: id, demoSince: {'.sv':'timestamp'}}},
        'status/session': {connectionId: id, phase: 'ready'},
        'status/response': 'successful'
      });
      reportError('');
      lifecycle.complete?.(id);
    } catch (failure) {
      reportError('Connection reset could not complete while ' + step + ': ' + (failure.message || failure.code || 'unknown error') + '. Reload the app to retry.');
    } finally {
      working = false;
      if (!stopped && connectionId !== id) void respond();
    }
  }
  const fail = () => reportError('Cannot read connection handshake. Deploy the updated Firebase rules.');
  const subscriptions = [
    onValue(ref(database, 'status/communication'), snapshot => {request = snapshot.val(); loaded.add('request'); void respond();}, fail),
    onValue(ref(database, 'status/connectionId'), snapshot => {connectionId = snapshot.val(); loaded.add('id'); void respond();}, fail),
    onValue(ref(database, 'status/session'), snapshot => {
      session = snapshot.val(); loaded.add('session');
      if (session?.phase === 'resetting') lifecycle.pause?.();
      if (session?.phase === 'ready' && session.connectionId === connectionId) lifecycle.complete?.(session.connectionId);
      void respond();
    }, fail)
  ];
  return () => {stopped = true; subscriptions.forEach(stop => stop());};
}
