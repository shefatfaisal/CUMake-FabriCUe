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

// Capacitor regenerates Package.swift on sync. Reapply native Firebase dependencies.
// 11.11.0 retains Swift 5.9 support for this project's Xcode 16.1 toolchain.
const packageURL=new URL('../ios/App/CapApp-SPM/Package.swift',import.meta.url);
let swiftPackage=await readFile(packageURL,'utf8');
if(!swiftPackage.includes('firebase-ios-sdk.git')){
 swiftPackage=swiftPackage.replace('    dependencies: [','    dependencies: [\n        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: "11.11.0"),');
}
if(!swiftPackage.includes('.product(name: "FirebaseCore"')){
 swiftPackage=swiftPackage.replace('            dependencies: [','            dependencies: [\n                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),\n                .product(name: "FirebaseAppCheck", package: "firebase-ios-sdk"),');
}
await writeFile(packageURL,swiftPackage);
const storyboardURL=new URL('../ios/App/App/Base.lproj/Main.storyboard',import.meta.url);
let storyboard=await readFile(storyboardURL,'utf8');
storyboard=storyboard.replace('customClass="CAPBridgeViewController" customModule="Capacitor"','customClass="SmartLaundryBridgeViewController" customModule="CapApp_SPM"');
await writeFile(storyboardURL,storyboard);
project=await readFile(projectURL,'utf8');
if(!project.includes('GoogleService-Info.plist in Resources')){
 project=project.replace('/* Begin PBXBuildFile section */','/* Begin PBXBuildFile section */\n\t\t534C00000000000000000003 /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = 534C00000000000000000004 /* GoogleService-Info.plist */; };');
 project=project.replace('/* Begin PBXFileReference section */','/* Begin PBXFileReference section */\n\t\t534C00000000000000000004 /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };');
 project=project.replace('504EC3131FED79650016851F /* Info.plist */,','504EC3131FED79650016851F /* Info.plist */,\n\t\t\t\t534C00000000000000000004 /* GoogleService-Info.plist */,');
 project=project.replace(/(\/\* Begin PBXResourcesBuildPhase section \*\/[\s\S]*?files = \()/,'$1\n\t\t\t\t534C00000000000000000003 /* GoogleService-Info.plist in Resources */,');
}
// Debug builds need no App Attest signing entitlement; Release builds do.
project=project.replace(/(504EC3181FED79650016851F \/\* Release \*\/ = \{[\s\S]*?buildSettings = \{)([\s\S]*?)(\n\t\t\t\};)/,(_,head,body,tail)=>head+(body.includes('CODE_SIGN_ENTITLEMENTS')?body:'\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;'+body)+tail);
await writeFile(projectURL,project);
console.log('Configured native Firebase App Check bridge and iOS Firebase configuration.');
