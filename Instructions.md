# Smart Laundry: Codex handoff

## Resume here
The immediate task is getting the prepared iOS app running on the user's Intel 2018 Mac (macOS 15.7.9), with Xcode 16.1 and a physical iPhone on iOS 26.5.2. Xcode is not yet confirmed installed. Native compilation/signing/device tests have NOT happened; this workspace is Linux. Verify actual device compatibility rather than assuming SDK and physical-device support are the same.

Read IOS-SETUP.md, README.md and ESP32-FIREBASE.md, then inspect package.json and git status. Many changes are uncommitted, including essential untracked files. Preserve them all. Copying just committed Git history will lose work.

## Goal and agreed architecture
One YRM1003 reader plus ESP32 (hardware/PlatformIO code on teammate's computer) sends raw tags to Firebase RTDB. The open browser or installed iPhone app processes scans and writes return commands. No Cloud Functions or Blaze plan; no user login for this single-system public prototype. Processing requires an active app; background local timer notifications do not provide background Firebase processing.

Firebase project lightlink-cbe74; RTDB https://lightlink-cbe74-default-rtdb.firebaseio.com; browser app https://lightlink-cbe74.web.app/smart-laundry.html.

Add clothing: take/select photo, then scan to assign tag. Profiles/photos/tag links/counts persist in RTDB. Hackathon mode counts each new scan event as a wear (not once/day); identical event IDs are deduplicated. ESP32 suppresses continuous tag detection until tag absent for 3 seconds. a=green (>1 wears remaining), b=yellow (1), c=red (0), d=flashing red manual test. Highest severity in a 2-second group wins. Pre-wash laundry comparison is implemented in laundry-rfid.js: select clothes via cart, start RFID check in the ready-stage panel, scan fresh tags, resolve missing/unexpected items before wash timer. Check baseline/results persist locally with the load. Cloud laundry completion/reset and return verification remain outstanding (legacy controls still disabled).

## Critical connection/reset contract
Explicit user request: EVERY NEW ESP32 connection clears ALL previous demo clothes, photos, tags, scans, counts, commands, acknowledgements, and local plans. Ordinary scans must not reset anything.
Firmware generates a new connectionId; writes /status/response='waiting', /status/connectionId, then /status/communication='success'. App claims /status/session resetting, clears demo data atomically, installs new closet settings connectionId, marks ready and /status/response='successful'. ESP32 waits for successful before scanning/streaming. Scans and acknowledgements include connectionId; rules reject stale session writes. localStorage smart-laundry-connection-id avoids reset on app reload. App must be open for handshake. Fixed invalid Firebase root ref(database,'') to ref(database), deployed and verified live.

Signals are /signal object with value, commandId, revision etc; firmware applies and writes /acknowledgement with commandId/value/appliedAt/connectionId. Legacy /latest removed and blocked.
Firmware uses Firebase_ESP_Client; required config: firebaseConfig.database_url = FIREBASE_DATABASE_HOST; firebaseConfig.signer.test_mode = true. Host is lightlink-cbe74-default-rtdb.firebaseio.com. Using .host in test_mode caused blank DNS. Firmware source is external; don't claim edits here update hardware. Posted firmware also had d flashing green, 5-second command timeout, initial stream snapshot skipped, and EPC buffer too short: inspect with teammate if needed.

## Files
- smart-laundry.html: user's original large self-contained UI, shared by browser and native builds; use targeted reads (embedded assets huge).
- server/web/laundry-rfid.js: UI bridge and registration. laundry-firebase.js: Firebase orchestration.
- closet-sync.js: transactional persistence, photos, migration/outbox, session guards.
- demo-processing.js: per-event wears/counts; indicator.js: signal severity/grouping.
- communication.js: handshake/reset; database.rules.json: public prototype validation/session rules.
- scripts/prepare-web.mjs generates ignored server/web/smart-laundry.html.
- native/: camera/Photos, share/export, timer notifications, native layout and UI bridge.
- scripts/build-native.mjs bundles Firebase locally with esbuild, enforcing single @firebase/app registry and no remote CDN SDK imports.
- capacitor.config.json: com.lightlink.smartlaundry, webDir native-dist, no hosted server URL.
- ios/App/App.xcodeproj: Capacitor 7 SPM project, iOS minimum16.4. ALL Capacitor dependencies now major7 for Xcode16.1. Replaced Capacitor8 AppDelegate/scene scaffolding with official7 template; SceneDelegate removed. Icon/splash/permissions/privacy retained.
- scripts/configure-ios.mjs reapplies photo permissions and Filesystem privacy C617.1.
- legacy/ios-light/: archived obsolete SwiftUI light demo; don't add to app target.

## Commands and validation
On Mac install Node24.12+ (.nvmrc), then npm ci; npm run ios:sync; npm run ios:open. Choose Apple signing team and connected iPhone in Xcode; enable Developer Mode/trust as prompted. npm run ios:check does unsigned Simulator compilation on Mac.

Latest successful local checks after Capacitor7 adaptation: npm run check, npm run test:native, npm run test:communication, npm run test:sync, npm run ios:sync. Firebase rules/app emulator suites passed before native dependency adaptation. Camera/share/notifications/native Swift execution remain unverified.

npm run ios:package creates artifacts/SmartLaundry-iOS-source.tar.gz (source only, excludes node_modules). Archive rebuilt after Capacitor7 adaptation, but this handoff was written afterward; transfer this file separately or rebuild archive including it. Prefer copy entire working directory excluding node_modules/build caches and private .aws/.codex/.firebase directories. npm run deploy affects browser hosting and database rules; it does not update installed iOS bundles.

Next: help install/open Xcode and resolve any real build/device error; do not redesign working app or recreate project. User prefers concrete progress and short clear instructions.
