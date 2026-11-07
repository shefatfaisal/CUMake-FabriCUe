# LightLink — Smart Laundry hackathon demo

The ESP32 uploads RFID scan events to Firebase. The open Smart Laundry app processes
those events, updates wears remaining, and saves the result back to Firebase.
**No Cloud Functions or Blaze plan are needed for this workflow.**

```text
RFID → YRM1003 → ESP32 → Firebase /scans
                              ↕
                   Open Smart Laundry app
                   computes wears remaining
                              ↕
                       Firebase /closet
```

## Installed iPhone app

The actual iOS project is ready at `ios/App/App.xcodeproj`. It bundles your HTML
interface and Firebase SDK locally with Capacitor, plus native camera/Photos,
backup sharing, and laundry timer notifications. See [IOS-SETUP.md](IOS-SETUP.md)
for Mac requirements, signing, and installation.

On a Mac with Xcode 16.1+ and Node 24.12+:

```sh
npm ci
npm run ios:sync
npm run ios:open
```

This Linux workspace cannot compile/sign the iOS app. The web bundle and native
adapters are tested; camera and notification delivery still need an iPhone test.
Keeping the app active is still required for immediate RFID processing/handshakes.

## Run and deploy

Use Node.js 22 or later. From this repo:

```sh
npm install
npm run login
npm run deploy
npm run preview
```

`npm run deploy` publishes **only database rules and Hosting**. It does not deploy
Cloud Functions. Deployment is necessary because the app now has permission to
write processed wardrobe state directly. If rules are already deployed, start local
preview with just `npm run preview`.

- Smart Laundry app: **http://localhost:8000/smart-laundry.html**
- All raw RFID scans: **http://localhost:8000/**
- Expected hosted app: **https://lightlink-cbe74.web.app/smart-laundry.html**

These URLs are destinations, not confirmation that the latest code is deployed.
The preview uses the real Firebase project. Do not run `firebase init` over this setup.
`npm run preview` and `npm run deploy` prepare a served copy of the root
`smart-laundry.html`. Edit that root file; the copy in `server/web` is generated.

If you previously deployed `saveCloset` or `countWearFromScan`, remove those old
functions from the Firebase console before using this mode. Redeploying only Hosting
and rules does not remove previously deployed functions. The app no longer calls or
needs them; the old function source/dependencies have been removed from the project.

## Clothing setup and migration

Open the app in the **same browser and origin used previously**. Existing clothing
profiles, photos, RFID assignments, counts, and dates are imported into Firebase.
Existing cloud records win over stale cached copies. On migration errors, local
clothing data is retained. Export Backup is still available for an additional copy.
A `file://` page, localhost, and a hosted site have separate browser storage; restore
an exported backup in the target origin if necessary.

To add clothing:

1. Tap **Add Clothing**, take or choose a photo, and enter details and a wear limit.
2. Tap **Next: Scan RFID Tag** and wait for the live connection.
3. Bring only that clothing's tag to the reader.
4. The next new scan assigns its tag and saves the clothing automatically.

Saved scan history is ignored during enrollment. Assigned tags are rejected; several
tags detected in one batch require scanning only the intended tag again. Cancel
stops enrollment. If the tag is already in range, remove it and bring it back to
produce a new ESP32 event. The registration event does not consume a wear.

The banner shows cloud connection, pending saves, and errors. Wait for **Saved in
Firebase** before closing after an edit. A second browser can load the same wardrobe.
Calendar plans, display name, and laundry timers are still local to each browser.

## Demo counting behavior

```text
New clothing with limit 5 → 5 wears remaining
Next uploaded scan      → 4 remaining
Another uploaded scan   → 3 remaining
At zero remaining       → laundry due
```

There is **no once-per-day restriction** in the hackathon demo. The original daily
reducer is retained only as a reusable/tested model; app mode calls the per-event
demo reducer. The database retains `tracking.wears` as the number of allowances
used for compatibility with the design. `tracking.remainingWears` is the decreasing
value shown on closet cards and clothing profiles. It never goes below zero.

Processing rules:

- Every unique uploaded scan event is processed once; its ID and outcome are
  stored under `/closet/processedScans` in the same transaction as the count.
- Refreshing or two open app windows cannot consume the same event twice.
- Initial registration and pre-migration/pre-demo history never consume wears.
- Unknown tags remain in raw history but do not change clothing counts.
- Active laundry items are skipped until the bedroom return check completes and
  restores their wear allowance in Firebase.
- **Use One Wear (Demo)** manually consumes one allowance using the same app logic.
- Swiping left skips laundry without changing wears.
- Deleting raw `/scans` does not reset clothing counts or processed-event records.

The ESP32 should upload **one event per tag appearance**, not every radio detection.
Suppress repeats while the tag stays in range, and re-arm that tag only after an
absence. Different event IDs deliberately consume separate allowances in demo mode.

**Keep the Smart Laundry app open for immediate processing.** Firebase keeps scans
while the app is closed. On reopening, the app processes saved events not already
marked processed. The raw scan-library page alone does not process wardrobe counts.
The installed iPhone app uses this processing approach while active; continuous
background RFID processing is not provided.

## Return signal to ESP32

The app now sends automatic `a/b/c` results and supports manual `d` testing. See
[ESP32-FIREBASE.md](ESP32-FIREBASE.md) for the exact firmware read/write contract.

- Read **`/signal/value`**: `a` green (>1 wear remaining), `b` yellow (1 remaining),
  `c` red (0 remaining), or `d` flashing red (missing-item alert/test).
- Read the full `/signal` object to obtain its `commandId` and `revision`.
- After applying a command, firmware writes `/acknowledgement` with the same
  `commandId`, `value`, and a Firebase server `appliedAt` timestamp.
- The persistent app banner distinguishes a saved command from Device confirmed.
- Highest severity wins for tags scanned within a two-second group. Later groups
  start fresh. Physical reader deduplication still belongs in ESP32 firmware.
- Test A/B/C/D buttons are on the app Scanner screen. They do not consume wears.
- Automatic `d` is sent when a pre-wash laundry check finds missing or unexpected tags.

This still uses app-side computation and Firebase transactions, with no Cloud
Functions or paid services required by this workflow. The app must be open to send
new computed results. `/signal` is the sole return-command object.

## ESP32 connection handshake and full reset

**Every fresh ESP32 connection starts an empty demo**, as requested. Clothing,
photos, RFID links, counts, scan history, commands and acknowledgements are deleted.
The app also clears its local data and reloads once. Normal tag scans keep their data.

Firmware must generate a unique connection ID per Wi-Fi connection, then write:

```text
/status/response      = "waiting"
/status/connectionId  = "<new unique ID>"
/status/communication = "success"
```

Keep the updated Smart Laundry app open. It atomically clears the previous data,
sets `/status/session` to ready, and writes `/status/response = "successful"`.
Only then should firmware begin scanning. Include the current connection ID in
**every scan and LED acknowledgement**. Regenerating it per scan would reset the demo;
reusing it across restarts would prevent a new reset.

The old three-letter strings alone cannot detect reconnects reliably; the firmware
update is required. Refreshing the app with the same connection ID never resets the
server data again. Connection/session metadata is preserved solely to prevent
repeated resets. See [ESP32-FIREBASE.md](ESP32-FIREBASE.md) for the full firmware contract.

## ESP32 upload format

Append one record per appearance with an HTTPS POST:

```http
POST /scans.json HTTP/1.1
Host: lightlink-cbe74-default-rtdb.firebaseio.com
Content-Type: application/json

{
  "tagId": "E200001234",
  "receivedAt": {".sv": "timestamp"},
  "connectionId": "YOUR_CURRENT_CONNECTION_ID"
}
```

No authentication is required for this single-system prototype. Firebase generates
a scan ID and resolves its server timestamp. Preserve tag IDs as strings, including
leading zeros. The ID must contain a letter/digit and be at most 256 characters.
`connectionId` is required after a connection reset; it must match the active session. Check the HTTP response for upload success.
Do not PUT over `/scans`: raw history is append-only and existing events cannot be
changed/deleted by clients. An offline upload's receipt time is not its physical scan
time. Future event-time tracking needs a separate agreed firmware timestamp field.

References: [Firebase REST writes](https://firebase.google.com/docs/database/rest/save-data),
[server values](https://firebase.google.com/docs/reference/rest/database#section-server-values).

## Database structure

```text
scans/<event ID>/                 raw ESP32 tagId + receivedAt
closet/settings/                 processing: app, mode: demo, timezone, demoSince
closet/items/<clothing ID>/
  profile/                       name, type, color, limit, RFID, photoKey
  tracking/                      wears used, remainingWears, wornDates, trackingSince
  revision                       profile edit version
closet/processedScans/<event ID>/ outcome and processing timestamps
closet/appliedRequests/          app save retry protection
clothingPhotos/<photoKey>        photo data URL
signal/                         return command: value, commandId, revision, etc.
acknowledgement/                ESP32-applied commandId, value, appliedAt
```

Photos are separate so transactions do not repeatedly transfer the image data.
After a connection reset, photo records contain data URLs plus their connection ID.
The app's writes and counters use Firebase transactions to prevent lost updates.
Photo/profile data and scan history are publicly accessible for this no-login
prototype; wardrobe writes are now allowed for app processing. Avoid root-level
public access. For broader use, add authentication and move images to object storage.
The browser retains a local cache and pending edit IDs to recover offline edits.

## Testing the demo

1. Deploy, open Smart Laundry, and wait for the saved banner. Confirm migrated
   clothing names, photos, RFID links, and counts.
2. Add a new clothing item through photo → scan → assignment. With limit 5 it
   should show 5 remaining immediately after registration.
3. Remove the tag from reader range long enough to re-arm it, then scan again:
   4 remaining. Repeat: 3 remaining. No need to wait for a different day.
4. Refresh: remaining must stay 3, not decrease from history replay.
5. Close all Smart Laundry windows, generate a new scan, reopen: the new event
   should be processed once. Check `/closet/processedScans` for its outcome.
6. Two open Smart Laundry windows should still consume each event only once.

## Checks

```sh
npm run check
npm run test:scans
npm run test:laundry
npm run test:wear
npm run test:demo
npm run test:indicator
npm run test:communication
npm run test:sync
npm run test:firebase
npm run test:app
```

The Firebase tests use local Auth/Realtime Database emulators under `demo-lightlink`;
Java 21+ is required. No Functions emulator or paid Firebase services are needed.
They check rules, migration, profile/photo restoration, offline changes, duplicate
processing across two clients, and same-day allowance consumption. No tests write
to the live database. Visual browser and hardware testing must be done on your setup.

## Next stages

The old light prototype is archived in `legacy/ios-light`. The current installed
iPhone project is `ios/App/App.xcodeproj`; see `IOS-SETUP.md`.

Google Calendar integration remains next. Pre-wash RFID checks and bedroom return
resets are implemented in the open app. The installed iPhone app adds local timer
notifications, while scan processing remains foreground-only.
See `Smart Laundry Solution.pdf` for the project concept and agreed demo changes.

### Check clothes before washing and after drying

Add clothes to the cart and start a laundry load. In the laundry panel, tap **START RFID CHECK**, then scan each selected clothing tag. The panel shows present, missing/not yet scanned, and unexpected items. Previous scans do not count. Remove unexpected pieces, tap **RESTART CHECK**, and rescan the complete load. The wash timer requires a live Firebase connection and a matching load. Untagged clothing must be linked first. Keep the app open; checks and timers stay on this device.

After drying, use **START BEDROOM CHECK** in the return panel. Scan each item from the load, then tap **CONFIRM RETURN**. That restores full wear allowance in Firebase and clears the load. Confirm stays disabled while any selected item is still missing.
