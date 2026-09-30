# Kills per level cap run

Show how many enemies you killed on each Void Cascade run. Squadmates' kills are a plus, not a must.

## What we know (tested 2026-09-30)

- EE.log never logs kill counts, per player or otherwise. The end-of-mission screen only logs that it loaded (`Created /Lotus/Interface/EndOfMatch.swf`).
- `https://api.warframe.com/cdn/getProfileViewingData.php?playerId=<accountId>` returns lifetime stats. The sum of `Stats.Enemies[].kills` is the lifetime kill total, and it equals the sum of `Stats.Weapons[].kills`.
- A mission's kills reach that total about a minute after the mission ends. Test: the total was 1,979,602 before one mission and 1,979,715 after it (+113, the same as the end-of-mission screen), and `MissionsCompleted` went 7,739 → 7,740 at the same moment.
- Stats don't change mid-mission, so any reading taken during the run is a valid "before" number.
- Your own account ID is already stored (`codex-profile.json`, `_loadAccountId()` in `services/codexProfile.ts`), and the Codex feature already calls this endpoint.

## Phase 1: your kills

### Data

`LevelCapRun.kills?: number`: enemies you killed on the run. Absent when unknown: an old run, a fetch failure, or the app not running at the end of the mission. `normalizeRun` keeps only finite, non-negative integers.

### New service: `services/levelCapKills.ts`

- `readLifetimeStats(accountId)`: GETs the endpoint and returns `{ kills, missionsEnded, at }`.
  - `kills` = sum of `Stats.Enemies[].kills`.
  - `missionsEnded` = `MissionsCompleted + MissionsQuit + MissionsFailed + MissionsInterrupted`, so an aborted run still counts as ended.
  - Parses only those fields; the full personal-profile parse is skipped because the response is about 580 KB.
  - Goes through the existing HTTPS helper in `codexProfile.ts` (export it), bypassing that file's 60 s snapshot cache.
- **Before snapshot:** taken when the mission starts, then re-read about 2 and 10 minutes in, keeping the latest reading. The re-reads cover a Cascade started less than a minute after another mission, while that mission's stats are still posting. If the app joins a run already in progress (`primeLevelCapFromLog`), it takes the reading then.
- **After snapshot:** when the mission ends and a run was logged (by the hotkey or at mission end), poll every 30 s for up to 10 minutes until `missionsEnded` is higher than the before reading. Then `kills = after.kills - before.kills` goes onto the run with `store.updateRun`. On timeout, log a warning and leave `kills` unset.
- No account ID, or no before snapshot: do nothing.

### Wiring (`services/levelCapTracker.ts`)

- A `start` event starts the before-snapshot schedule.
- An `end` event, once `finishMission` knows the run ID, starts the after poll. Missions below 107 Exolizers log no run, so nothing is fetched for them.
- An EE.log reset (game restart) cancels any pending timers.

### UI

- Each run row in the frame modal shows `1,234 kills`, plus kills per minute when `durationSec` is known.
- While the after poll is running, the row shows `kills…`.
- Analytics tab: add `kills` and `kills/min` as run metrics in the chart builder.

### Tests

- Stats reader: a trimmed fixture of a real response, a response missing `Stats`, and bad JSON.
- Flow, with a fake fetch and fake timers:
  - A re-read replaces the before reading.
  - The after poll waits for `missionsEnded` to move.
  - The poll times out and leaves `kills` unset.
  - No account ID means no fetches.
  - A game restart cancels pending timers.
- Store: `kills` round-trips through `normalizeRun`, and junk values are dropped.

### Known limits

- Runs from before this feature can't get kills; the old lifetime numbers are gone.
- If the app is closed when a mission ends, that run gets no kills.
- Each run makes about 3 before reads plus 1 to 20 after polls, at about 580 KB each.

## Phase 2: squadmates (needs research first)

Blocked on mapping squad names to account IDs:

- `AddSquadMember: <name>, mm=<id>` is a matchmaking ID, not the account ID. Yours logs as `A464FDDF…` while your account ID is `5b9b0220…`.
- The endpoint has no lookup by name (`?n=` returns an empty body).
- Leads for a live squad test:
  - `SendSessionUpdate ... "memberAccountId":"<id>"`
  - `VoidProjections` lines (fissures only)
  - Whatever gets logged when you open a squadmate's profile in game

Once names map to IDs, the phase 1 diff works per player. Private profiles show nothing.
