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

## Phase 2: squadmates (built 2026-09-30, removed 2026-10-03)

Removed. It read up to four profiles per run, several times each, and DE's Akamai edge started answering `api.warframe.com` with 403 21 minutes after it shipped. By 2026-10-03 IPv4 was blocked too, and game login failed. Only your own profile is read now. Squad kills already saved on old runs still show in the squad hover. The notes below record how it worked.

`mm=` on `AddSquadMember` is a matchmaking id (for some players it is just their name), not the account id. A public fissure run with two others (2026-09-30) showed account ids the profile endpoint accepts. Both were checked against it, and it returns `Results[0].DisplayName`:

- `Net [Info]: Trying to connect to <host>, flags: 0, id=<accountId>`: the host's id, logged when you join someone else's session.
- `VoidProjections: Client got reward info from <accountId>` and `Still waiting on response from <accountId>`: every player in the squad, you included, when a relic resolves. Void Cascade is always a fissure, and no one can join after the first relic is open (except rejoining after a crash), so the whole squad shows up.

The parser collects these ids per mission (`LevelCapMission.accountIds`, plus an `account` event for ids seen mid-run). The kill counter reads every account's profile during the run, polls each one after it, and applies the same one-mission check as for you. A squadmate's kills go on their `squadLog` row (`kills`), matched by the profile's display name. The squad hover on each run row shows them.

Gaps: private profiles show nothing. A squadmate who played another mission before the after-reading gets skipped. A squadmate who leaves more than two minutes before the end can get their kills absorbed by a baseline re-read.
