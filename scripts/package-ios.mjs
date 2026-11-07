import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const out=fileURLToPath(new URL('../artifacts/SmartLaundry-iOS-source.tar.gz',import.meta.url));
const files=['package.json','package-lock.json','capacitor.config.json','.nvmrc','smart-laundry.html',
 'native','scripts','ios','server/web','tests','IOS-SETUP.md','README.md','ESP32-FIREBASE.md',
 'firebase.json','database.rules.json','legacy'];
const exclusions=['ios/App/App/public','ios/App/App/capacitor.config.json','ios/App/App/capacitor.plugins.json',
 'ios/App/App/config.xml','ios/App/Pods','ios/App/build','ios/App/output','ios/App/CapApp-SPM/.build',
 'server/web/smart-laundry.html','*/xcuserdata','*/DerivedData'];
const result=spawnSync('tar',[...exclusions.map(path=>'--exclude='+path),'-czf',out,...files],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
console.log('Created '+out+' (source only; run npm ci on the Mac).');
