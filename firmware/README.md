# Smart Laundry ESP32 firmware

PlatformIO project for the YRM1003 RFID reader, NeoPixel indicator, and Firebase
Realtime Database handshake used by Smart Laundry.

## Secrets (required once per machine)

Wi‑Fi credentials are **not** stored in git.

```sh
cp include/secrets.example.h include/secrets.h
```

Edit `include/secrets.h` and set `WIFI_SSID` / `WIFI_PASSWORD`.  
`FIREBASE_DATABASE_HOST` stays in `include/firebase_config.h` (public demo host).

## Build / flash

```sh
cd firmware
pio run
pio run -t upload
pio device monitor
```

Keep the Smart Laundry app open so the connection handshake can complete before
scans upload. See root [`ESP32-FIREBASE.md`](../ESP32-FIREBASE.md) for the
`/status`, `/scans`, `/signal`, and `/acknowledgement` contract.
