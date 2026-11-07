# FabriCUe — Smart Laundry Solution for Dorm Students

Connected clothing tracker and laundry manager for dorm life. RFID tags on clothes, a doorway reader, and a mobile app work together so students know what they’ve worn, what needs washing, when laundry fits their schedule, and whether anything is missing from a load.

## Problem

Dorm students juggle classes, work, shared laundry rooms, and messy clothing habits. It’s easy to:

- Lose track of which clothes have been worn
- Wait until almost nothing clean is left
- Forget items in the room when heading to laundry
- Leave clean clothes behind in the laundry room
- Accidentally treat unrelated clothes as washed

FabriCUe pulls wear tracking, laundry planning, reminders, and load verification into one system.

## Goals

- Reduce effort needed to track clothing use
- Help students plan laundry before they run out of wearable clothes
- Fit laundry sessions into their schedules
- Remind students when washing and drying are nearly finished
- Detect clothing missing from an outgoing or returning load
- Prevent unrelated clothing from having its wear history reset

## System components

| Component | Purpose |
| --- | --- |
| Individual RFID tags | Give each clothing item a unique identity |
| Doorway RFID reader | Detect tagged clothing moving through the doorway |
| Mobile app | Store clothing profiles, show wear counts, manage laundry loads, send reminders |
| Scheduling system | Support manual laundry times or calendar-based scheduling |
| Reader indicator light | Visible alert (for example, flashing red when a selected laundry item is missing) |

The RFID reader identifies clothing. The app interprets those readings based on the current activity: everyday wear tracking or laundry load verification.

## Hardware and data flow

**Hardware stack**

- RFID tags attached to clothing
- **YRM1003** RFID reader at the doorway
- **ESP32** microcontroller for local scan handling and Wi-Fi upload
- Reader indicator light for missing-item alerts

**Data flow**

```text
Clothing RFID tag
  → YRM1003 RFID reader
  → ESP32 (local store + Wi-Fi)
  → Cloud
  → Mobile app
```

The ESP32 stores scan data locally and uploads it over Wi-Fi. The mobile app reads cloud data to update wear counts, track laundry progress, and surface missing-item alerts.

## Clothing setup and profiles

Students register each clothing item and link it to its RFID tag.

Each clothing profile includes:

- Photo of the item
- Color
- Category (shirt, hoodie, pants, shorts, jeans, etc.)
- Unique RFID identifier
- Wear-day limit before washing
- Current wear count and laundry status

Wear limits are student preferences (or app defaults by clothing type). Example: a shirt limited to five wear days. The app estimates laundry need from recorded wear days; it does not sense whether clothing is physically clean.

## Everyday wear tracking

In normal operation, a wear day is recorded when a registered item leaves the room.

Rules:

- At most **one wear count per item per calendar day**
- Multiple doorway trips on the same day do not add more counts
- The next calendar day can add another count

Example:

1. Student leaves wearing a hoodie → count +1
2. Returns and leaves again later the same day → no extra count
3. Leaves again the next day → count can increase again

Assumption for the initial concept: clothing leaving the room during normal tracking has been worn. Clothes carried out for other reasons may need refinement during development.

## Clothing status and visual tracking

Each item’s progress toward its wear limit uses a green / yellow / red indicator.

| Status | Meaning |
| --- | --- |
| Green — Good to Wear | Comfortably below the wear limit |
| Yellow — Almost Time for Laundry | Approaching the wear limit |
| Red — Needs Washing | At or past the wear limit |

The clothing tracker has three matching tabs. Each item shows its photo, current wear count, and limit (for example, `4 of 5 wear days`).

The exact threshold for yellow will be defined during development and should scale sensibly across different wear limits.

## Laundry scheduling

After setup, the app can prompt students to connect Google Calendar. Two approaches:

### Manual scheduling

Students pick laundry days and times (for example, every Sunday afternoon or a specific evening).

### Automatic scheduling

With calendar access, the app looks for free time inside the student’s preferred laundry hours. When enough clothing is near or past its wear limit, it proposes a session.

Automatic scheduling should consider:

- How many items need washing or are approaching limits
- Calendar commitments
- Allowed laundry hours
- Expected wash + dry duration
- Existing laundry sessions

Trigger item count, session length, and reschedule behavior remain adjustable project rules.

## App home page

The home dashboard is the main entry point and should surface the next useful action based on session state:

- Upcoming laundry sessions
- Clothing tracker (wear counts and status)
- Ready for Laundry (start load review)
- Active laundry session (wash → dry → return)
- Alerts (missing items, timer reminders)

## “Ready for Laundry” swipe review

Before a session, the student taps **Ready for Laundry** and reviews clothes in a swipe interface, prioritized:

1. Red — needs washing
2. Yellow — approaching limit
3. Green — still wearable

Each card shows photo, wear count, limit, and status.

| Gesture | Action |
| --- | --- |
| Swipe right | **Wash it** — add to laundry cart |
| Swipe left | **Skip it** — leave out of the load; reduce displayed wear count by one day (never below zero) |

Skip is a product judgment call: it postpones washing in the UI without physically cleaning the item. Revisit this rule as the product develops.

## Laundry cart and departure check

After review, the student taps **Done** and confirms the cart summary.

The reader then enters **laundry departure mode**. Only items in the confirmed cart affect the load check.

As selected items leave the room:

- Marked as detected
- Status → **Being Washed**
- App tracks which cart items are still missing

If an item is still unscanned after the departure window, the app sends a forgotten-item notification (photo + profile) and the reader flashes red.

Use a short scan window or an explicit “done scanning” step before declaring something missing — a full load may take several moments to pass the doorway.

## Washing and drying tracking

When the selected load has left the room, the home page shows **Track Your Laundry**.

**Washing**

1. Tap Start Washing
2. Enter wash-cycle duration
3. Start the app timer
4. Notifications: 5 minutes before end, and at completion

**Drying**

1. Tap Start Drying
2. Enter drying duration
3. Start the next timer
4. Same 5-minute and completion notifications

This version uses student-entered timers. Direct washer/dryer machine communication is out of scope for the initial concept.

## Return check and wear-count reset

After drying, the system enters **laundry return mode** and looks for items from that session.

As each expected item returns through the doorway:

- Marked as returned
- Wear count resets to **0**
- Status returns to **Good to Wear**

If some items return and others do not, the app notifies which clothing is missing. Unreturned items stay unresolved in the session — they are not automatically marked clean.

## Protecting unrelated clothing

Laundry scans must affect **only** items in the active laundry cart.

Example: a student wears a hoodie while carrying a laundry basket. If that hoodie is not in the confirmed load, detecting its tag must **not** reset its wear count or mark it washed.

The same rule applies on return.

Technically the reader may still see nearby tags. The app must filter readings so:

- Only expected laundry items update the active session
- Everyday wear counting stays separate from laundry verification
- A laundry departure does not accidentally add a wear day

## Main operating states

| State | System behavior |
| --- | --- |
| Normal tracking | Record at most one wear day per item per day |
| Laundry selection | Student reviews clothing and builds a cart |
| Departure check | Verify selected items leave the room |
| Washing | Track student-started wash timer and reminders |
| Drying | Track student-started drying timer and reminders |
| Return check | Verify returning items and reset their wear counts |
| Completed / unresolved | Close when all items return, or show missing items |

## Build design summary

```text
┌──────────────┐     doorway scan      ┌────────────┐     Wi-Fi      ┌───────┐
│ RFID clothing │ ───────────────────▶ │ YRM1003 +  │ ─────────────▶ │ Cloud │
│ tags          │                      │ ESP32      │                └───┬───┘
└──────────────┘                      │ + light    │                    │
                                      └────────────┘                    ▼
                                                               ┌────────────────┐
                                                               │ Mobile app     │
                                                               │ profiles       │
                                                               │ wear tracking  │
                                                               │ scheduling     │
                                                               │ laundry flow   │
                                                               │ alerts         │
                                                               └────────────────┘
```

**Product loop**

1. Register clothes + RFID tags + wear limits
2. Track wear as items leave the room (once per day)
3. Surface green / yellow / red laundry readiness
4. Schedule laundry manually or via calendar
5. Swipe to build a laundry cart
6. Departure check → wash timer → dry timer → return check
7. Reset wear counts only for verified returned cart items

## Open decisions for development

These are called out in the plan as rules to refine while building:

- Yellow-status threshold relative to wear limit
- How many near-limit items trigger automatic scheduling
- Default laundry session duration and reschedule behavior
- Scan-window length vs explicit completion for missing-item alerts
- Whether swipe-left should reduce wear count (current concept: yes, never below zero)
- Handling clothes carried out without being worn

## Repository status

This repository holds the FabriCUe / Smart Laundry Solution project for CU Make. Implementation (firmware, cloud, and mobile app) will land here as the build progresses.

## License

TBD
