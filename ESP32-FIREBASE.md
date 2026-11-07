# ESP32 ↔ Firebase demo contract

Database: `https://lightlink-cbe74-default-rtdb.firebaseio.com`
No login is required for these single-system prototype paths. Deploy the current
rules before testing. Keep Smart Laundry open to compute signals immediately.

**A new ESP32 connection intentionally erases all previous demo data.** This includes
clothing profiles, photos, tag links, wear counts, scan history, old commands and
acknowledgements, and local app plans/load progress. A normal tag scan never resets
the demo. The connection/session metadata remains so the same handshake cannot wipe
data repeatedly.

## Required firmware startup sequence

Generate a **new unique connection ID on every Wi-Fi connection/reconnection**.
Use letters/digits, `:`, `_`, or `-`, between 8 and 100 characters. A MAC address plus
a fresh random suffix works. Do not use the MAC alone or regenerate this ID per tag.
Retain this ID for every scan and acknowledgement until the next connection.

Send these public HTTPS writes in order (Content-Type: application/json):

```text
PUT /status/response.json       body: "waiting"
PUT /status/connectionId.json   body: "C049EF13B4AC-NEW-RANDOM-SUFFIX"
PUT /status/communication.json  body: "success"
```

Wait for `GET /status/response.json` (or its stream) to return `"successful"`.
**Do not upload scans or start the `/signal` command stream until then.** The open app first clears all previous data in
one atomic update, then replies successful. It also refreshes its local storage to
prevent old clothing/photos from being imported back into the empty wardrobe.

A bare repeated `"success"` cannot identify a new connection. The unique ID is
mandatory for the reset. Reusing an ID or refreshing the app does not reset again.
If no app is open, the request waits until Smart Laundry is opened. If the app is
interrupted mid-reset, reopening it resumes the pending reset.


## 1. Upload one RFID event per appearance

```http
POST /scans.json
Content-Type: application/json

{"tagId":"YOUR_REAL_TAG_ID","receivedAt":{".sv":"timestamp"},"connectionId":"YOUR_CURRENT_CONNECTION_ID"}
```

Use a fresh generated event ID for each appearance. Suppress repeated reader
detections while a tag stays in range. Each separate uploaded event intentionally
uses one allowance in hackathon demo mode.

## 2. Read the return command

```http
GET /signal.json
```

Example response:

```json
{
  "value": "b",
  "commandId": "-exampleScanEventId",
  "connectionId": "YOUR_CURRENT_CONNECTION_ID",
  "revision": 7,
  "createdAt": 1793836800000,
  "source": "scan",
  "itemIds": [123],
  "groupStartedAt": 1793836800000
}
```

| `value` | Indicator |
|---|---|
| `a` | Green: more than one wear remaining |
| `b` | Yellow: exactly one wear remaining |
| `c` | Red: zero wears remaining |
| `d` | Flashing red: missing-item alert / manual indicator test |

Read the **`value` field inside the `/signal` object**. If the firmware only needs the letter, `GET /signal/value.json` returns
`"a"`, `"b"`, `"c"`, or `"d"`; reading the whole object also gives a consistent
command ID for acknowledgement.

Poll or stream `/signal` independently of RFID scanning. Otherwise an app test or
future missing-item alert cannot reach the device until another tag is scanned.
Start with a 500 ms polling interval for this small demo. An absent (`null`) command
means no instruction yet; leave the indicator in its startup state and keep polling.
Do not interpret a non-empty string as a boolean.

When a new `commandId` arrives:

1. Read `value` and validate it is `a`, `b`, `c`, or `d`.
2. Apply the LED state; stop a previous flashing mode when switching to a/b/c.
3. Write the acknowledgement below. Record the command as handled only after a
   successful acknowledgement write, so network failures can be retried.
4. Keep the LED state until another command. On reconnect, discard cached commands
   and complete the full reset handshake before reading `/signal` again. A null
   signal after reset means wait for a new command.

Flashing should use the ESP32's nonblocking timer approach so uploads and command
polling continue. Invalid JSON/values or failed HTTP responses must not be treated
as successful commands.

## 3. Acknowledge the applied command

```http
PUT /acknowledgement.json
Content-Type: application/json

{
  "commandId": "-exampleScanEventId",
  "connectionId": "YOUR_CURRENT_CONNECTION_ID",
  "value": "b",
  "appliedAt": {".sv":"timestamp"},
  "connectionId": "YOUR_CURRENT_CONNECTION_ID"
}
```

Copy `commandId` and `value` from the command actually applied. The app displays
**Device confirmed** only when both fields match its current command. Reading a
value alone or being connected to Wi-Fi is not an acknowledgement. This confirmation
means the firmware ran the instruction, not that a sensor verified the LED's light.

## Behavior to expect

- Registration does not consume a wear. The next separate scan uses one allowance.
- App processing stores counts and a canonical command atomically in `/closet`.
  It then mirrors the command to `/signal` using increasing revisions. A stale app
  cannot replace a newer mirrored revision. Reopening repairs a missing mirror.
- Tags scanned in a group within two seconds of the group's first scan share the
  highest severity: red > yellow > green. A later group starts fresh; an old red
  tag does not keep unrelated later scans red forever.
- Unknown tags, enrollment/history events, and active laundry items do not change
  the indicator. Delayed older events cannot replace a newer scan group.
- The Scanner screen has TEST A/B/C/D buttons for checking the return path without
  consuming clothing allowances. A later scan or test replaces that test command.
- `d` is available for testing. Automatic missing-item comparisons are not implemented yet.
- When all app windows are closed, scans are stored but no new result is computed
  until Smart Laundry is opened again. The ESP32 retains its last command meanwhile.

## Quick test

1. Deploy: `npm run deploy`. Start preview: `npm run preview`.
2. Open `http://localhost:8000/smart-laundry.html` → Live RFID Scanner.
3. Press TEST A. Firebase `/signal/value` should become `a`.
4. Firmware reads it, shows green, and writes `/acknowledgement`.
5. The app changes from Waiting for ESP32 acknowledgement to Device confirmed.
6. Repeat TEST B, C, and D to check yellow, red, and flashing red.
7. Add clothing with a small limit and scan separate appearances to test automatic
   transitions. All indicator commands use `/signal`.

## Connection reset details

`/status/session` records `{connectionId, phase}`. While phase is `resetting`, normal
uploads and wardrobe writes are blocked. The atomic reset clears `/scans`,
`/clothingPhotos`, `/signal`, `/acknowledgement`, legacy user/results/request nodes,
and replaces `/closet` with empty settings for the new connection. In the same
update, session phase becomes `ready` and `/status/response` becomes `"successful"`.

The same ready session cannot reset again. Old-session photos, commands, wardrobe
writes and scan uploads are rejected rather than resurrected. Every new scan and
LED acknowledgement must include the current `connectionId`. Both status strings
are still simple JSON strings; the response is a separate read, not a changed HTTP
response body from the original request. There are no Cloud Functions.
