# Install Smart Laundry on an iPhone

The iOS app is a Capacitor native shell with your Smart Laundry interface bundled
inside it. It is installed and launched from the iPhone Home Screen. It uses the
same Firebase data, scan processing, connection reset, and ESP32 return commands
as the browser app. It does not load the UI from the hosted website.

## What is ready

- Xcode project: `ios/App/App.xcodeproj` (Swift Package Manager).
- Locally bundled interface, fonts, JavaScript, and Firebase SDK.
- Native camera / Photos selection for clothing pictures.
- Native share sheet to export wardrobe backups to Files, AirDrop, etc.
- Wash/dry local notifications five minutes before and at the entered timer end.
- Calendar laundry plans (manual or AUTO) schedule a 30-minute warning and an at-time
  reminder on the phone. AUTO can optionally connect Google Calendar (client-side) to
  suggest a free slot; wardrobe-only AUTO works without it. No cloud push is required.
- Safe-area layout, app icon, launch artwork, and camera/photo permission text.
- Existing Firebase handshake, RFID assignment, demo wears remaining, and a/b/c/d.

The native bridge preserves the HTML design. The old SwiftUI light demo is archived
under `legacy/ios-light`; do not add those files to the new Xcode target.

## Mac requirements

Use a Mac with **Xcode 16.1 or newer** and its Command Line Tools. This project uses Capacitor 7, which requires
Xcode 16.0 or newer; see [the official environment requirements](https://capacitorjs.com/docs/v7/getting-started/environment-setup).
The project targets **iOS 16.4+**. Install Node **24.12+** (the repo includes `.nvmrc`)
to satisfy the bundled Firebase packages' current Node engine requirements.

An Intel Mac can build this project. The connected iPhone must run an iOS version
supported by your installed Xcode; check the run destination in Xcode.

Xcode uses Swift Package Manager. You do not need CocoaPods for this project.
An internet connection is needed on the Mac for npm and Swift package resolution.

This workspace is Linux: Xcode compilation, signing, Simulator execution, camera,
photo permissions, and notification delivery have **not** been tested here. Web
bundle build, plugin synchronization, native-adapter tests, phone-sized browser
layout, and bundled Firebase connection have been verified.

## Transfer and prepare

Copy the whole repo to the Mac, or use `artifacts/SmartLaundry-iOS-source.tar.gz`.
If using the archive, extract it into an empty folder and open Terminal there.
Do not copy `node_modules` from Linux; install Mac dependencies from the lockfile.

```sh
npm ci
npm run ios:sync
npm run ios:open
```

`ios:sync` builds `native-dist`, copies assets into the native project, regenerates
the Swift package references, and reapplies permissions/privacy manifest settings.
`ios:open` opens the existing project in Xcode. Do not run `cap add ios` again.

## Sign and run on your iPhone

1. In Xcode, choose the **App** target, then **Signing & Capabilities**.
2. Enable **Automatically manage signing** and select your Apple account's team.
   Add your Apple account in Xcode Settings → Accounts if needed.
3. If the bundle identifier is unavailable, change it to a unique value such as
   `com.yourname.smartlaundry`. Update `appId` in `capacitor.config.json` to match.
4. Connect your iPhone by USB, trust the Mac, and select the iPhone as run destination.
5. Press **Run**. Enable Developer Mode / trust the developer if iOS requests it.
6. Launch **Smart Laundry** on the phone and allow camera/photos/notifications when
   using those features. Free personal signing may require periodic rebuilding.

The app needs internet for Firebase. No localhost address, Firebase password,
GoogleService-Info.plist, Firebase Swift package, or new backend is needed for the
current no-login prototype. `npm run preview` does not need to run after installation.

For an unsigned Simulator compilation check on the Mac:

```sh
npm run ios:check
```

For photo testing, use a physical iPhone; Simulator camera support is limited.

## Check the demo on the phone

1. Open the app and wait for the Firebase saved/connected banner.
2. Keep the app active, then connect the ESP32 using the connection-ID handshake.
   **As requested, every new ESP32 connection deletes all previous demo clothing,
   photos, scans, counts, commands, and acknowledgements.**
3. Add clothing, take a photo or select one, then tap Next: Scan RFID Tag.
4. Scan the tag to assign it. A later separate scan decreases wears remaining.
5. Open Live RFID Scanner and use TEST A/B/C/D. Confirm the physical indicator and
   its matching acknowledgement in the app.
6. Export Backup; the iOS share sheet should offer Save to Files / AirDrop.
7. Start a short wash timer and allow notifications. Lock the phone and confirm
   the timer-end reminder arrives. For a five-minute warning, use a longer timer.
8. Open Calendar, save a manual or AUTO SUGGESTION plan a few minutes ahead, lock
   the phone, and confirm the laundry reminder. Remove the plan and confirm it
   does not fire again. With a Client ID configured, connect Google Calendar from
   AUTO and confirm a free day/time is suggested from your schedule.
9. Reopen the app and verify timer state, clothing data, and Firebase reconnection.

### Google Calendar Client ID (optional)

1. In Google Cloud, create an OAuth **Web** client.
2. Enable **Google Calendar API** for the same project
   (APIs & Services → Library → Google Calendar API → Enable). If this is off,
   Connect works but AUTO shows a permission error.
3. Add authorized JavaScript origins for `http://localhost:8000`, your Hosting URL,
   and `capacitor://localhost` for the installed app.
4. Paste the client ID into `server/web/google-calendar-config.js` as `GOOGLE_CLIENT_ID`.
5. While the OAuth consent screen Publishing status is **Testing**, open
   **Audience → Test users** and add every Gmail that should connect (for example
   `faisalshefat@gmail.com`). Without that, Google shows
   `Error 403: access_denied` / “has not completed the Google verification process”.
6. Rebuild/sync the iOS app (`npm run ios:sync`) after changing the client ID file.

Native reminders can be delivered while the app is backgrounded, but **RFID
processing and successful handshake replies still need the app active**. Local
notifications do not make Firebase processing run continuously in the background.
Another open browser can also process the shared prototype data.

## Updating the installed app

After changing the root HTML, Firebase modules, or native JavaScript adapters:

```sh
npm run ios:sync
```

Then build/run again in Xcode. Hosting deployment does not update locally bundled
code in an already installed app. Use `npm run deploy` only when you intend to
update the browser site or database rules.

Native-only code is under `native/`. The main HTML stays `smart-laundry.html`.
`server/web` remains the browser app. Do not edit generated `native-dist` or
`ios/App/App/public` files directly.

## Checks available here

```sh
npm run check
npm run test:native
npm run test:communication
npm run test:sync
npm run ios:sync
```

The build rejects external Firebase SDK imports and duplicate Firebase app registries.
The compiled iOS app still requires Mac/device validation. No IPA has been signed,
no TestFlight build uploaded, and no App Store submission performed.

References: [Capacitor iOS workflow](https://capacitorjs.com/docs/ios),
[camera permissions](https://capacitorjs.com/docs/apis/camera),
[local notifications](https://capacitorjs.com/docs/apis/local-notifications),
[Filesystem privacy manifest](https://capacitorjs.com/docs/apis/filesystem).

## Gemini verification in the installed iPhone app

Gemini uses native Firebase App Check rather than website reCAPTCHA on iOS.
The included `GoogleService-Info.plist` identifies the Firebase iOS app
`1:231995901001:ios:31f40f3cb20b303b10eb98`, project `lightlink-cbe74`, bundle ID
`com.lightlink.smartlaundry`. If your signing bundle ID differs, register that
bundle in Firebase and replace the plist with its matching configuration.

`npm run ios:sync` now installs the native bridge configuration automatically:
FirebaseCore and FirebaseAppCheck are pinned to 11.11.0 (Swift 5.9 compatible),
the plist is added as an app resource, and the storyboard uses the custom
Capacitor controller. No manual Firebase wizard initialization code is needed.
The web database identity stays separate; Gemini alone uses the iOS identity.
Limited-use tokens are requested for each AI call to support replay protection.

For **Xcode Debug builds** (including a physical phone):

1. Transfer the latest source archive to the Mac, extract into a new folder, and
   run `npm ci`, `npm run ios:sync`, then `npm run ios:open`.
2. In Xcode, use the Debug run configuration. Under Product → Scheme → Edit Scheme
   → Run → Arguments, add `-FIRDebugEnabled` if the Firebase debug token is not
   visible in the console.
3. Run on your phone and select a clothing photo. Copy the native Firebase App
   Check debug token from the **Xcode console**, keeping it private.
4. In Firebase → App Check → Apps, find **the iOS app**, open its ⋮ menu → Manage
   debug tokens, and register that token. A website/browser debug token is separate.
5. Restart the app and select a photo again. Do not reinstall just to retry, since
   that can change the device's debug token.

For **Release/TestFlight**:

- Register **App Attest** for this iOS app in Firebase App Check with your Apple
  Team ID. The Release configuration includes the production App Attest entitlement;
  enable the matching capability/provisioning in the Apple developer account.
- For fallback on devices without App Attest support, also register **DeviceCheck**
  and its Apple authentication key in Firebase App Check.
- Release builds never use the debug provider. Test an actual Release build before
  distributing; Debug success does not validate Apple attestation.

The Mac must resolve the new Firebase Swift packages on its first build. This
Linux environment verified JS routing and asset sync, but cannot compile the Swift
bridge or verify iPhone App Check. Run `npm run ios:check` on the Mac, then test a
photo on the phone. Keep website domain verification enabled.

References:
- https://firebase.google.com/docs/app-check/ios/debug-provider
- https://firebase.google.com/docs/app-check/ios/app-attest-provider
- https://firebase.google.com/docs/app-check/ios/devicecheck-provider
