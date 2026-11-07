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

1. In Google Cloud, create an OAuth **Web** client and enable the Calendar API.
2. Add authorized JavaScript origins for `http://localhost:8000`, your Hosting URL,
   and `capacitor://localhost` for the installed app.
3. Paste the client ID into `server/web/google-calendar-config.js` as `GOOGLE_CLIENT_ID`.
4. Rebuild/sync the iOS app (`npm run ios:sync`) after changing that file.

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
