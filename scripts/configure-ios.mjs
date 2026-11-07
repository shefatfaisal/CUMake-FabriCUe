import {readFile,writeFile} from 'node:fs/promises';
const plistURL=new URL('../ios/App/App/Info.plist',import.meta.url);
let plist=await readFile(plistURL,'utf8');
for(const [key,value] of Object.entries({
 UIUserInterfaceStyle:'Dark',
 NSCameraUsageDescription:'Take a photo to identify clothing in your wardrobe.',
 NSPhotoLibraryUsageDescription:'Choose clothing photos for your wardrobe.',
 NSPhotoLibraryAddUsageDescription:'Save a clothing photo when you choose to do so.'
})){
 const entry=`<key>${key}</key>\n\t<string>${value}</string>`;
 const re=new RegExp(`<key>${key}</key>\\s*<string>[\\s\\S]*?<\\/string>`);
 plist=re.test(plist)?plist.replace(re,entry):plist.replace(/<\/dict>\s*<\/plist>\s*$/,`\t${entry}\n</dict>\n</plist>\n`);
}
await writeFile(plistURL,plist);
const privacy=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>NSPrivacyTracking</key><false/>
<key>NSPrivacyAccessedAPITypes</key><array><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
</dict></array>
</dict></plist>
`;
await writeFile(new URL('../ios/App/App/PrivacyInfo.xcprivacy',import.meta.url),privacy);
const projectURL=new URL('../ios/App/App.xcodeproj/project.pbxproj',import.meta.url);
let project=await readFile(projectURL,'utf8');
if(!project.includes('PrivacyInfo.xcprivacy')){
 project=project.replace('/* Begin PBXBuildFile section */','/* Begin PBXBuildFile section */\n\t\t534C00000000000000000001 /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = 534C00000000000000000002 /* PrivacyInfo.xcprivacy */; };');
 project=project.replace('/* Begin PBXFileReference section */','/* Begin PBXFileReference section */\n\t\t534C00000000000000000002 /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };');
 project=project.replace('504EC3131FED79650016851F /* Info.plist */,','504EC3131FED79650016851F /* Info.plist */,\n\t\t\t\t534C00000000000000000002 /* PrivacyInfo.xcprivacy */,');
 project=project.replace(/(\/\* Begin PBXResourcesBuildPhase section \*\/[\s\S]*?files = \()/,'$1\n\t\t\t\t534C00000000000000000001 /* PrivacyInfo.xcprivacy in Resources */,');
}
project=project.replace(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/g,'IPHONEOS_DEPLOYMENT_TARGET = 16.4;');
await writeFile(projectURL,project);
console.log('Configured iPhone photo permissions and Filesystem privacy manifest.');
