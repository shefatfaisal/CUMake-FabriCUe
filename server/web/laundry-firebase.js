import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getDatabase, ref, onValue, runTransaction, update } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { readScans, groupTags } from './scan-data.js';
import {connectCloset} from './closet-sync.js';
import {startCommunication} from './communication.js';

const firebaseApp = getApps()[0] || initializeApp(firebaseConfig);
const database = getDatabase(firebaseApp);
const closet = connectCloset(firebaseApp);
let connected = false;
let loaded = false;
let scans = [];
let error = '';
let communicationError = '';
let serverTimeOffset = 0;
const report = () => window.laundryRfid.update({connected, loaded, scans, tags: groupTags(scans), error: error || communicationError, serverTimeOffset});
const timer = setTimeout(() => {
  if (!loaded && !error) {
    error = 'Scans have not loaded. Check your internet connection and Firebase /scans rules.';
    report();
  }
}, 12000);
const subscriptions = [
  startCommunication(database, {ref, onValue, runTransaction, update}, message => {communicationError = message; window.laundryRfid.showCommunicationError(message); report();}, {
    pause: () => closet.pauseForReset(),
    complete: id => window.laundryRfid.resetForConnection(id)
  }),
  onValue(ref(database, '.info/serverTimeOffset'), snapshot => {
    serverTimeOffset = Number(snapshot.val()) || 0;
  }),
  onValue(ref(database, '.info/connected'), snapshot => {
    connected = snapshot.val() === true;
    report();
  }),
  onValue(ref(database, 'scans'), snapshot => {
    loaded = true;
    scans = readScans(snapshot.val());
    error = '';
    clearTimeout(timer);
    report();
    closet.processScans(scans);
  }, failure => {
    clearTimeout(timer);
    error = /permission/i.test(failure.code || failure.message)
      ? 'Cannot read /scans. Deploy database.rules.json; scan access does not require login.'
      : 'Cannot load RFID scans. Check your internet connection.';
    report();
  })
];
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    clearTimeout(timer);
    subscriptions.forEach(unsubscribe => unsubscribe());
  }
});
