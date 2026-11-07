import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { readScans, groupTags } from './scan-data.js';

const database = getDatabase(initializeApp(firebaseConfig));
const select = id => document.getElementById(id);
const status = select('status');
let scans = [];
let tags = [];
let loaded = false;
let connected = false;
let errorMessage = '';
const dates = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'medium'});
const date = value => value === undefined ? '—' : dates.format(new Date(value));

function connectionStatus() {
  status.textContent = errorMessage || (!connected
    ? (loaded ? 'Offline · showing previously loaded scans. Reconnecting…' : 'Connecting to Firebase…')
    : loaded ? 'Live · connected to /scans' : 'Connected · loading saved scans…');
  status.dataset.connected = String(connected && loaded && !errorMessage);
}

function tableRows(target, rows) {
  const fragment = document.createDocumentFragment();
  for (const values of rows) {
    const row = document.createElement('tr');
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

function render() {
  select('scan-count').textContent = scans.length.toLocaleString();
  select('tag-count').textContent = tags.length.toLocaleString();
  select('last-scan').textContent = date(scans[0]?.receivedAt);
  const search = select('search').value.trim().toLowerCase();
  const matchingTags = tags.filter(tag => tag.tagId.toLowerCase().includes(search));
  const matchingScans = scans.filter(scan => scan.tagId.toLowerCase().includes(search));
  tableRows(select('tag-rows'), matchingTags.map(tag => [tag.tagId, tag.count, date(tag.firstSeen), date(tag.lastSeen)]));
  tableRows(select('scan-rows'), matchingScans.map(scan => [scan.tagId, date(scan.receivedAt), scan.id]));
  select('tag-empty').hidden = !loaded || matchingTags.length > 0;
  select('scan-empty').hidden = !loaded || matchingScans.length > 0;
  const empty = scans.length ? 'No tags match your search.' : 'No RFID scans stored yet. Scan a tag with your ESP32 to begin.';
  select('tag-empty').textContent = empty;
  select('scan-empty').textContent = empty;
}

select('search').addEventListener('input', render);
onValue(ref(database, '.info/connected'), snapshot => {
  connected = snapshot.val() === true;
  connectionStatus();
});
const loadingTimer = setTimeout(() => {
  if (!loaded && !errorMessage) {
    errorMessage = 'Scans have not loaded. Check your connection and deploy database.rules.json to allow /scans access.';
    connectionStatus();
  }
}, 12000);
onValue(ref(database, 'scans'), snapshot => {
  clearTimeout(loadingTimer);
  errorMessage = '';
  loaded = true;
  scans = readScans(snapshot.val());
  tags = groupTags(scans);
  render();
  connectionStatus();
}, error => {
  clearTimeout(loadingTimer);
  errorMessage = /permission/i.test(error.code || error.message)
    ? 'Cannot read /scans. Deploy the updated database.rules.json. No login is needed for this prototype.'
    : 'Could not load scans. Check Firebase and your internet connection.';
  connectionStatus();
});
