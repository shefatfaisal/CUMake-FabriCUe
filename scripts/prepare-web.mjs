import {readFile, writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../smart-laundry.html', import.meta.url), 'utf8');
for (const script of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=/.test(script[1]) && script[2].trim()) throw new Error('Inline code inside an external script is ignored by browsers');
  if (!/\bsrc=/.test(script[1])) new vm.Script(script[2], {filename: 'smart-laundry.html'});
}
if (!source.includes('/laundry-rfid.js')) throw new Error('Missing RFID integration script');
if (!process.argv.includes('--check')) {
  await writeFile(new URL('../server/web/smart-laundry.html', import.meta.url), source);
  console.log('Prepared smart-laundry.html for local preview and Firebase Hosting.');
}
