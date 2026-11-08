import {mkdir, readFile, writeFile, copyFile, readdir, unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, join} from 'node:path';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=resolve(root,'native-dist');
await mkdir(out,{recursive:true});
// Remove stale generated bundles so removed features are not shipped by cap sync.
for(const file of await readdir(out))if(file.endsWith('.js'))await unlink(join(out,file));
const ui=await readFile(resolve(root,'smart-laundry.html'),'utf8');
if(!ui.includes('/laundry-rfid.js'))throw Error('Missing Smart Laundry Firebase bridge.');
const nativeUI=ui
 .replace(/<script>\s*\/\/ Both the browser picker[\s\S]*?<\/script>/,'')
 .replace('<p class="sub muted">Selected photos are sent to Google Gemini to suggest clothing details.</p>','')
 .replace(/<p id="photo-analysis-status"[^>]*>[\s\S]*?<\/p>/,'')
 .replace('void analyzeAddPhoto(photo,version)','');
const nativeHTML=nativeUI.replace('<script src="/web-reminders.js"></script>','').replaceAll('double-click title','double-tap title').replaceAll('Double-click a card','Double-tap a card').replace('width=device-width,initial-scale=1','width=device-width,initial-scale=1,viewport-fit=cover')
 .replace('</style><body>','</style><link rel="stylesheet" href="/native.css"><body>')
 .replaceAll("document.getElementById('photo').click()",'window.smartLaundryUI.pickPhoto()')
 .replace('</body>','<script src="/native-bridge.js"></script><script type="module" src="/native-runtime.js"></script></body>');
await writeFile(join(out,'index.html'),nativeHTML);
// Preserve the scan viewer as a separate native page; / remains the app home.
const scansHTML=(await readFile(resolve(root,'server/web/index.html'),'utf8'))
 .replace('width=device-width,initial-scale=1','width=device-width,initial-scale=1,viewport-fit=cover')
 .replace('</head>','<style>body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}</style></head>');
await writeFile(join(out,'scans.html'),scansHTML);
for(const file of ['laundry-rfid.js','bootstrap.js','scans.css'])await copyFile(resolve(root,'server/web',file),join(out,file));
for(const file of ['native-bridge.js','native.css'])await copyFile(resolve(root,'native',file),join(out,file));
const firebaseCDN={name:'local-firebase-sdk',setup(b){
 // The CLI's transitive Firebase packages can otherwise create two app registries.
 b.onResolve({filter:/^@firebase\/app$/},args=>{
  if(args.pluginData?.unifiedFirebaseApp)return;
  return b.resolve(args.path,{resolveDir:resolve(root,'node_modules/firebase'),kind:args.kind,pluginData:{unifiedFirebaseApp:true}});
 });
 b.onResolve({filter:/^https:\/\/www\.gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|database|ai|app-check)\.js$/},async args=>{
  const service=args.path.match(/firebase-(app|database|ai|app-check)\.js$/)[1];
  return b.resolve('firebase/'+service,{resolveDir:root,kind:'import-statement'});
 });
}};
const result=await build({entryPoints:{'laundry-firebase':resolve(root,'server/web/laundry-firebase.js'),scans:resolve(root,'server/web/scans.js'),
 'native-runtime':resolve(root,'native/runtime.js'),'schedule-auto':resolve(root,'server/web/schedule-auto.js')},outdir:out,bundle:true,splitting:true,format:'esm',platform:'browser',
 target:['safari16.4'],plugins:[firebaseCDN],minify:true,metafile:true,logLevel:'warning'});
const registries=new Set(Object.keys(result.metafile.inputs).filter(path=>path.includes('@firebase/app/dist/')).map(path=>path.split('@firebase/app/dist/')[0]));
if(registries.size!==1)throw Error('Native bundle must contain exactly one Firebase app registry.');
const files=await readdir(out);
for(const file of files.filter(file=>file.endsWith('.js'))){
 const text=await readFile(join(out,file),'utf8');
 if(/(?:from\s*|import\s*\()['"]https:\/\/www\.gstatic\.com/.test(text))throw Error('Unbundled remote SDK import in '+file);
}
console.log('Built installed-app assets in native-dist (Firebase SDK bundled locally).');
