export const WORLD_STATE_CONFIG = Object.freeze({
  // content.warframe.com/dynamic/worldState.php is 404 and oracle.browse.wf
  // Cloudflare-blocks /worldState.json for every client, so DE is the only source.
  fetchUrls: Object.freeze(["https://api.warframe.com/cdn/worldState.php"]),
  oracleBountyCycleUrl: "https://oracle.browse.wf/bounty-cycle",
  earthCycleUrl: "https://api.warframestat.us/pc",
  warframestatBaseUrl: "https://api.warframestat.us/pc",
  fetchTimeoutMs: 20_000,
  cycleFetchTimeoutMs: 4_000,
  earthCycleFetchTimeoutMs: 4_000,
  vallisEpochIso: "November 10, 2018 08:13:48 UTC",
  vallisPeriodMs: 1_600_000,
  vallisWarmMs: 400_000,
  poeNightMs: 3_000_000,
  duviriMoodPeriodMs: 7_200_000,
  duviriMoods: Object.freeze(["Sorrow", "Fear", "Joy", "Anger", "Envy"]),
});
