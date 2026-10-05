# Feature Specification: Set up the scheduler for timed reminders

**Feature Branch**: `200-reminder-scheduler`

**Created**: 2026-10-05

**Status**: Draft

**Input**: User description: "ST-200 Set up the scheduler for timed reminders (Notion story https://app.notion.com/p/3ee607bff0d2813ab7d3eb3ebb239d3b, epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). So that appointment and ITP reminders go out on the right day, we need scheduled jobs that send each reminder once."

**Sources**: Notion story ST-200, read 2026-10-05; its Build brief (current as of 2026-10-03) wins over the criteria above it. Foundations build-timeline row https://app.notion.com/p/3ee607bff0d2816dbaeef827a965eff8 (lane D · Messaging, W4, 5 points, blocked by ST-194 and ST-197, both merged). The pipeline of ST-194 (`libs/domain/src/notifications/notifications.service.ts`: one message per event and person, quiet hours), the preferences of ST-197 and the SMS cap of ST-392.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A due-date reminder goes out 30 and 7 days before, once each (Priority: P1)

A reminder records what it is about (a car), its kind (ITP, service, RCA, rovinietă) and its due date. The daily 09:00 run (Europe/Bucharest) sends it 30 days and 7 days before the date, once each, through the notifications pipeline, which follows the driver's switches, channels and quiet hours.

**Why this priority**: the story's purpose; every reminder kind rests on the once-only daily run.

**Independent Test**: register a reminder, run the daily run at fixed clock times, read the NOTIFICATION rows and the reminder's flags.

**Acceptance Scenarios**:

1. **Given** a reminder (kind `itp`, due on 10 December 2026), **When** the run of 10 November 2026 happens, **Then** DUE_ITP goes once, sent_30 is set, and a second run that day sends nothing.
2. **Given** the same reminder, **When** the run of 3 December happens, **Then** DUE_ITP goes once more and sent_7 is set.
3. **Given** a reminder registered 5 days before its date, **When** the next run happens, **Then** only the 7-day reminder goes (the 30-day one is past) and both flags are set.
4. **Given** a later story changes the due date, **When** the change is registered, **Then** sent_30 and sent_7 reset and the new date applies.
5. **Given** a car is removed, **When** the removal is registered, **Then** its reminders are deleted and none of them is sent.

---

### User Story 2 - The daily run keeps local time and catches up after a stop (Priority: P1)

The run starts at 09:00 Europe/Bucharest every day, across the clock changes. A worker that was down at 09:00 runs the missed run once when it starts; the flags stop any duplicate. A run at night (a catch-up at 23:15) writes the bell rows at once, and the outside messages wait until 08:00.

**Why this priority**: a reminder sent on the wrong day, twice, or never is the failure the story exists to prevent.

**Independent Test**: compute the run times around 25 October 2026 and 28 March 2027; start the scheduler at 11:20 and at 23:15 and read what it queued and sent.

**Acceptance Scenarios**:

1. **Given** the clocks change on 25 October 2026, **When** the next days' runs are scheduled, **Then** they start at 09:00 Europe/Bucharest (06:00 UTC before, 07:00 UTC after), not at 09:00 UTC; likewise across 28 March 2027.
2. **Given** the worker was down at 09:00, **When** it starts at 11:20 the same day, **Then** it runs that day's run once, and the next run is due the next day at 09:00.
3. **Given** the worker was down all day and starts at 23:15, **When** it runs the missed run, **Then** the reminders' bell rows are written at once and their e-mail, push, SMS or WhatsApp rows are held until 08:00 the next morning.
4. **Given** a run fails, **When** it is retried, **Then** it retries 3 times with backoff, logs an error, and never sends a reminder twice.

---

### User Story 3 - Booking and tyre reminders (Priority: P2)

A confirmed booking gets BOOKING_REMINDER the day before. A car gets TYRES_SEASON on 1 November (winter) and 1 April (summer), once per car per season.

**Why this priority**: the remaining reminder kinds the brief asks this story to prove with test data; the stories that own bookings and tyres wire the real objects.

**Independent Test**: register a booking reminder and tyre reminders, run the daily run on the days around them, read the rows.

**Acceptance Scenarios**:

1. **Given** a booking for tomorrow at 08:00 is registered, **When** today's run happens, **Then** BOOKING_REMINDER goes to the driver once.
2. **Given** that booking is cancelled before the run, **When** the run happens, **Then** no reminder goes; **Given** it is moved to another day, **Then** the reminder goes only the day before the new day.
3. **Given** a car's winter tyre reminder, **When** the run of 1 November 2026 happens, **Then** TYRES_SEASON goes once with season_year 2026, and a second run that season sends nothing; the summer reminder goes on 1 April 2027.

---

### User Story 4 - Per-object timers and the sweep (Priority: P2)

Later stories (request, quote and booking timers) set a timer on an object with a stable job id `<kind>-<id>`. Replacing or removing it means the old timer never fires; a 5-minute sweep finds an object whose timer was lost and runs it once.

**Why this priority**: the brief's scheduler includes it for the other queues; no timer kind of this epic uses it yet, so it is proved with a test kind.

**Independent Test**: set, replace and clear a timer with a test kind against Redis, then lose one and run the sweep.

**Acceptance Scenarios**:

1. **Given** a timer `request-expiry-{id}` set for later, **When** it is replaced with a new time, **Then** only one job with that id exists, due at the new time.
2. **Given** that timer is cleared, **When** its time comes, **Then** nothing fires.
3. **Given** an object is overdue and its timer was lost, **When** the sweep runs, **Then** the kind's handler runs once for it.

---

### User Story 5 - Shortened dates in the test environment (Priority: P3)

In a test environment, a configuration value makes a reminder "day" last a few seconds or minutes, so the whole 30-day and 7-day sequence is shown working end to end.

**Why this priority**: it is how the jobs are shown working; it must never reach production.

**Independent Test**: start the reminders worker with a shortened day against PostgreSQL and Redis, register an ITP reminder due 31 shortened days ahead, wait, read the bell.

**Acceptance Scenarios**:

1. **Given** a shortened day in a test environment and an ITP reminder due 31 days ahead, **When** the worker runs, **Then** the driver's bell gets the 30-day DUE_ITP and then the 7-day one, in that order, once each.
2. **Given** the shortened day is set with APP_ENV `production` or `staging`, **When** the worker starts, **Then** it refuses to start.

### Edge Cases

- A reminder whose date is already past when the run sees it: nothing goes; its flags stay as they were.
- A reminder whose driver account is deleted: the pipeline writes nothing for it (ST-194); the flag is still set so it is not tried every day.
- Two runs at once (a catch-up and the 09:00 run): each reminder goes once, as the pipeline writes one message per event and person.
- A reminder registered for a kind with no 30/7 rule (tyres, booking) is sent by its own rule only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A REMINDER row MUST hold the driver it goes to, the car (or the booking) it is about, its kind (`itp`, `service`, `rca`, `rovinieta`, `tyres_winter`, `tyres_summer`, `booking`), its due date (none for tyres), the flags sent_30 and sent_7, the season_year last sent and sent_at. One row per car and kind, and one per booking.
- **FR-002**: The daily run MUST send, for each `itp`, `service`, `rca` and `rovinieta` reminder whose due date is ahead, the 30-day reminder when the date is 8 to 30 days away and sent_30 is not set, and the 7-day reminder when the date is 0 to 7 days away and sent_7 is not set (which also sets sent_30), as DUE_ITP, SERVICE_DUE, DUE_RCA or DUE_ROVINIETA. A reminder already flagged MUST NOT be sent again.
- **FR-003**: The daily run MUST send TYRES_SEASON for a `tyres_winter` reminder on a run in November and for a `tyres_summer` reminder on a run in April, once per season: it sets season_year to the season's year, and a reminder whose season_year is that year MUST NOT be sent again.
- **FR-004**: The daily run MUST send BOOKING_REMINDER for a `booking` reminder on the day before its date, once (sent_at set).
- **FR-005**: Every reminder MUST go through the notifications pipeline with an event id made of the reminder, its stage and its due date, so that the person's switches, channels, SMS cap and quiet hours apply and a repeated or concurrent run writes no second message.
- **FR-006**: The registration hooks for later stories MUST: set a car's due date for a kind (creating the reminder, or resetting its flags when the date changes and leaving them when it does not); set a car's two tyre reminders; delete every reminder of a removed car; set a booking's reminder (resetting it when the date changes); and delete a cancelled booking's reminder.
- **FR-007**: The reminders run MUST be scheduled daily at 09:00 Europe/Bucharest, computed in local time so it stays at 09:00 across clock changes, one job per day with the job id `daily-<day>`.
- **FR-008**: When the worker starts after that day's 09:00, it MUST run that day's run at once, then schedule the next day's.
- **FR-009**: A failing run MUST be retried 3 times with exponential backoff and MUST log an error when it fails for good.
- **FR-010**: Per-object timers MUST use the job id `<kind>-<object id>`: setting one replaces any earlier timer of that id, clearing one removes it, and a sweep every 5 minutes MUST run each kind's handler once for each object the kind reports overdue.
- **FR-011**: A configuration value (`REMINDER_DAY_MS`) MUST shorten a reminder day to that many milliseconds, with the daily run repeating at that interval and dates counted in shortened days from the worker's start; the worker MUST refuse to start with it set when APP_ENV is `staging` or `production`.

### Key Entities

- **Reminder** (new, `cars` module): the driver, the car or booking, the kind, the due date, sent_30, sent_7, season_year, sent_at.
- **Notification** (exists, ST-194): one row per channel per reminder stage.

## Clarifications

### Session 2026-10-05

- Q: The brief reads CAR (owner_id, removed_at) and BOOKING (starts_at, status), but neither table exists yet. Where does a reminder find its driver, and how does a removed car or a cancelled booking stop it? → A: The reminder holds its driver (`account_id`) and the car or booking id without a foreign key; the registration hooks (FR-006) are what the car and booking stories call on a removal, a cancel or a move. The car story adds the foreign key and its cascade when CAR exists. (autonomous default, Principle I: no CAR or BOOKING table invented here)
- Q: The brief's REMINDER kinds leave out bookings, while the booking reminder comes from the same 09:00 run. → A: A `booking` kind in the same table, with the booking id and its date as due_on; one run, one table, one guard. (autonomous default, Principle I)
- Q: Which daily runs does this story schedule? The brief lists compliance, documents, media-retention, insights and sms-counter too. → A: Only `reminders`. The others have no job yet (their stories build them) and would be empty schedules; the SMS counter needs no reset, as its month is part of its key (`sms-counter.ts`). (autonomous default, Principle I)
- Q: When is SERVICE_DUE sent, which the brief leaves "as set by its story"? → A: On the same 30 and 7 days as ITP until its story says otherwise. (autonomous default)
- Q: A run that missed a day (the worker was down): does a 30-day reminder still go the day after? → A: Yes: a reminder goes on the first run inside its window (8–30 days, 0–7 days), so a missed run is caught the next day. (autonomous default; scenario 3 of the brief)
- Q: The brief names the timer job id `request-expiry:{id}`; BullMQ refuses a custom id containing `:` (`node_modules/bullmq/dist/cjs/classes/job.js`). → A: `request-expiry-{id}`, and `daily-<day>` for the daily run; the id is just as stable. (autonomous default, evidence in code)
- Q: How is "shown working with shortened dates" proved, when the end-to-end job starts no worker and no screen shows reminders? → A: By an integration test that runs the real worker with a shortened day against PostgreSQL and Redis and reads the driver's bell rows, as ST-392 proved its reminders. (autonomous default, `specs/392-sms-whatsapp/spec.md` Assumptions)

## Spec Delta

### Capability: `notifications`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Across two runs on each of the 30-day and 7-day days, an ITP reminder produces exactly 2 bell rows (integration test).
- **SC-002**: The run times computed for 24–26 October 2026 and 27–29 March 2027 are all 09:00 in Europe/Bucharest (unit test).
- **SC-003**: A catch-up at 23:15 writes the bell rows at once and holds every outside row until 08:00 (integration test).
- **SC-004**: With a shortened day, the bell gets the 30-day and then the 7-day DUE_ITP, once each (integration test with the real worker).

## Assumptions

- The reminders are proved with test rows: the car stories (Driver account basics) and Quotes and booking register the real ones through the hooks. (Build brief › Events and notifications)
- After a car transfer, reminders go to the new owner *(proposed)*: left to the transfer story, which moves the rows' driver. (autonomous default)
- The bell text of the reminder types is the generic one until their stories write theirs (`templates/due-itp.ts`). (autonomous default)
- No audit history: sending a reminder is not a change. (Build brief › Data)
