// Trimmed inventory in the shape the game's API returns: one equipped Dante
// loadout, one saved Nezha Prime loadout and an unslotted Nezha.
const oid = (id: string) => ({ $oid: id.padStart(24, "0") });
const CURRENT = oid("1");

export const DANTE_SUIT_ID = "a1".padStart(24, "0");

export function levelCapInventory(): Record<string, unknown> {
  return {
    FocusAbility: "/Lotus/Upgrades/Focus/Power/PowerFocusAbility",
    CurrentLoadOutIds: [CURRENT, CURRENT],
    LoadOutPresets: {
      NORMAL: [
        {
          n: "Cap Dante",
          FocusSchool: "AP_DEFENSE",
          ItemId: CURRENT,
          s: { ItemId: oid("a1"), mod: 1 },
          l: { hide: true },
          p: { ItemId: oid("b1"), mod: 0 },
          m: { ItemId: oid("c1"), mod: 0 },
          h: { ItemId: oid("d1"), mod: 0 },
        },
        {
          n: "Nezha Tank",
          ItemId: oid("e9"),
          s: { ItemId: oid("a2"), mod: 0 },
        },
      ],
      SENTINEL: [
        {
          ItemId: CURRENT,
          s: { ItemId: oid("f1"), mod: 0 },
          l: { ItemId: oid("f2"), mod: 0 },
        },
      ],
    },
    Upgrades: [
      {
        ItemId: oid("u1"),
        ItemType: "/Lotus/Upgrades/Mods/Warframe/AvatarPowerMaxMod",
        UpgradeFingerprint: '{"lvl":10}',
      },
      {
        ItemId: oid("u2"),
        ItemType: "/Lotus/Upgrades/Mods/Aura/EnemyArmorReductionAuraMod",
        UpgradeFingerprint: '{"lvl":5}',
      },
      {
        ItemId: oid("u3"),
        ItemType: "/Lotus/Upgrades/CosmeticEnhancers/Offensive/PowerStrengthOnKill",
        UpgradeFingerprint: '{"lvl":5}',
      },
      {
        ItemId: oid("u4"),
        ItemType: "/Lotus/Upgrades/Mods/Pistol/WeaponDamageAmountMod",
        UpgradeFingerprint: '{"lvl":10}',
      },
    ],
    Suits: [
      {
        ItemId: oid("a1"),
        ItemType: "/Lotus/Powersuits/Pagemaster/Pagemaster",
        Configs: [
          { Upgrades: [] },
          {
            Name: "Cap",
            Upgrades: [
              oid("u1").$oid,
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              oid("u2").$oid,
              "",
              oid("u3").$oid,
            ],
            AbilityOverride: {
              Ability: "/Lotus/Powersuits/BrokenFrame/Abilities/BrokenRotAbility",
              Index: 3,
            },
          },
        ],
        ArchonCrystalUpgrades: [
          {
            Color: "ACC_RED_MYTHIC",
            UpgradeType:
              "/Lotus/Upgrades/Invigorations/ArchonCrystalUpgrades/ArchonCrystalUpgradeWarframeAbilityStrengthMythic",
          },
        ],
      },
      {
        ItemId: oid("a2"),
        ItemType: "/Lotus/Powersuits/Nezha/NezhaPrime",
        Configs: [{ Upgrades: [] }],
      },
      { ItemId: oid("a3"), ItemType: "/Lotus/Powersuits/Nezha/Nezha", Configs: [{ Upgrades: [] }] },
    ],
    Pistols: [
      {
        ItemId: oid("b1"),
        ItemType: "/Lotus/Weapons/Tenno/Pistols/PrimeAkarius/PrimeAkariusWeapon",
        Configs: [{ Upgrades: [oid("u4").$oid, "/Lotus/Upgrades/Mods/Pistol/RawUnrankedMod"] }],
      },
    ],
    Melee: [
      {
        ItemId: oid("c1"),
        ItemType: "/Lotus/Weapons/Corpus/Melee/KickAndPunch/PrismaObex",
        Configs: [{}],
      },
    ],
    SpaceGuns: [
      {
        ItemId: oid("d1"),
        ItemType: "/Lotus/Weapons/Tenno/Archwing/Primary/PrimeLarkspur/PrimeLarkspurWeapon",
        Configs: [{}],
      },
    ],
    Sentinels: [
      {
        ItemId: oid("f1"),
        ItemType: "/Lotus/Types/Sentinels/SentinelPowersuits/PrimeWyrmPowerSuit",
        Configs: [{}],
      },
    ],
    SentinelWeapons: [
      {
        ItemId: oid("f2"),
        ItemType: "/Lotus/Types/Sentinels/SentinelWeapons/SentElecRailgun",
        Configs: [{}],
      },
    ],
  };
}
