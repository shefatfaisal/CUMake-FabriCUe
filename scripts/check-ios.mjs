import {spawnSync} from 'node:child_process';
if(process.platform!=='darwin'){
 console.error('iOS compilation requires a Mac with Xcode 16.1+. Run npm run ios:sync here to prepare assets, then run this check on the Mac.');
 process.exit(2);
}
const result=spawnSync('xcodebuild',['-project','ios/App/App.xcodeproj','-scheme','App',
 '-destination','generic/platform=iOS Simulator','-derivedDataPath','ios/App/build',
 'CODE_SIGNING_ALLOWED=NO','build'],{stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exit(1);}
process.exit(result.status??1);
