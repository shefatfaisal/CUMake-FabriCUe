import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {readScans, groupTags} from '../server/web/scan-data.js';

const history = {
  first: {tagId: 'E200-A', receivedAt: 1000},
  second: {tagId: 'E200-B', receivedAt: 2000},
  third: {tagId: 'E200-A', receivedAt: 3000}
};

test('raw history preserves repeated scans while unique tags accumulate detection totals', () => {
  const scans = readScans(history);
  assert.deepEqual(scans.map(scan => scan.id), ['third', 'second', 'first']);
  assert.deepEqual(groupTags(scans), [
    {tagId: 'E200-A', count: 2, firstSeen: 1000, lastSeen: 3000},
    {tagId: 'E200-B', count: 1, firstSeen: 2000, lastSeen: 2000}
  ]);
  assert.deepEqual(readScans(null), []);
  assert.deepEqual(readScans({bad: 'a', missing: {tagId: 'X'}, empty: {tagId: '', receivedAt: 1}}), []);
});

async function viewer() {
  const source = (await readFile(new URL('../server/web/scans.js', import.meta.url), 'utf8'))
    .replace(/^import\s[\s\S]*?;\s*$/gm, '');
  function element() {
    return {textContent: '', value: '', dataset: {}, hidden: false, children: [], events: {},
      append(child) { this.children.push(child); },
      replaceChildren(fragment) { this.children = fragment.children; },
      addEventListener(name, callback) { this.events[name] = callback; }};
  }
  const elements = new Map();
  const listeners = new Map();
  vm.runInNewContext(source, {
    document: {getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createDocumentFragment: element, createElement: element},
    initializeApp: () => ({}), getDatabase: () => ({}), firebaseConfig: {},
    ref: (_, path) => path,
    onValue: (path, callback, error) => listeners.set(path, {callback, error}),
    setTimeout: () => 1, clearTimeout() {}, readScans, groupTags, Intl, Date
  });
  return {elements, listeners, receive: value => listeners.get('scans').callback({val: () => value})};
}

test('viewer restores saved scans, updates live, filters both tables, and shows offline and permission errors', async () => {
  const v = await viewer();
  v.listeners.get('.info/connected').callback({val: () => true});
  v.receive(history);
  assert.equal(v.elements.get('scan-count').textContent, '3');
  assert.equal(v.elements.get('tag-count').textContent, '2');
  assert.equal(v.elements.get('tag-rows').children.length, 2);
  assert.equal(v.elements.get('scan-rows').children.length, 3);
  assert.match(v.elements.get('status').textContent, /Live/);
  v.elements.get('search').value = 'e200-b';
  v.elements.get('search').events.input();
  assert.equal(v.elements.get('tag-rows').children.length, 1);
  assert.equal(v.elements.get('scan-rows').children.length, 1);
  v.receive({...history, fourth: {tagId: 'E200-B', receivedAt: 4000}});
  assert.equal(v.elements.get('scan-rows').children.length, 2);
  v.listeners.get('.info/connected').callback({val: () => false});
  assert.match(v.elements.get('status').textContent, /Offline/);
  assert.equal(v.elements.get('scan-count').textContent, '4');
  v.listeners.get('scans').error({code: 'PERMISSION_DENIED'});
  assert.match(v.elements.get('status').textContent, /Deploy/);
});

test('empty history and search misses are visible; tag content is rendered as text', async () => {
  const v = await viewer();
  v.receive(null);
  assert.equal(v.elements.get('tag-empty').hidden, false);
  assert.match(v.elements.get('tag-empty').textContent, /No RFID scans/);
  v.receive({event: {tagId: '<img src=x onerror=alert(1)>', receivedAt: 1000}});
  assert.equal(v.elements.get('tag-rows').children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  v.elements.get('search').value = 'not-found';
  v.elements.get('search').events.input();
  assert.equal(v.elements.get('tag-empty').hidden, false);
  assert.match(v.elements.get('tag-empty').textContent, /No tags match/);
});
