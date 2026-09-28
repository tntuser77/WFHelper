import type { LevelCapTile } from "./levelCapTypes";

/** Tuvul Commons rooms keyed by the implicit-bridge count EE.log prints for the
 * zone they fill, with the Exolizer spawns each room holds. Ported from the
 * tilescanner script; a count missing here is a room nobody has mapped yet. */
const ROOMS: ReadonlyMap<number, { name: string; exoSpawns: number }> = new Map([
  [78, { name: "Melica's Lab", exoSpawns: 3 }],
  [87, { name: "Hall of Legems", exoSpawns: 3 }],
  [105, { name: "Brig", exoSpawns: 3 }],
  [119, { name: "Agrizone", exoSpawns: 3 }],
  [120, { name: "Serenity", exoSpawns: 4 }],
  [142, { name: "Habitation Zone", exoSpawns: 3 }],
  [144, { name: "Lunaro", exoSpawns: 3 }],
  [162, { name: "Angel Roost", exoSpawns: 4 }],
  [164, { name: "Amphitheatre", exoSpawns: 3 }],
  [226, { name: "Albrecht's Park", exoSpawns: 4 }],
  [274, { name: "Cargo Bay", exoSpawns: 3 }],
  [402, { name: "Hangar", exoSpawns: 5 }],
  [493, { name: "Schoolyard", exoSpawns: 4 }],
]);

/** The three procedural room slots of the Void Cascade layout. */
const LEVEL_CAP_ROOM_ZONES: readonly number[] = [2, 6, 8];

/** Null until every room zone has reported. */
export function decodeLevelCapTile(bridges: ReadonlyMap<number, number>): LevelCapTile | null {
  if (!LEVEL_CAP_ROOM_ZONES.every((zone) => bridges.has(zone))) return null;
  const rooms = LEVEL_CAP_ROOM_ZONES.map((zone) => {
    const fingerprint = bridges.get(zone) ?? 0;
    const room = ROOMS.get(fingerprint);
    return {
      zone,
      fingerprint,
      name: room?.name ?? null,
      exoSpawns: room?.exoSpawns ?? null,
    };
  });
  const total = rooms.every((room) => room.exoSpawns !== null)
    ? rooms.reduce((sum, room) => sum + (room.exoSpawns ?? 0), 0)
    : null;
  return { rooms, total };
}
