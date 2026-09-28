import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseExolizerLine, readExolizersFromScreenshot } from "../../services/levelCapExolizerOcr";

describe("parseExolizerLine", () => {
  it("reads the counts through the usual OCR slips", () => {
    expect(parseExolizerLine("Round: 28 | Exolizers retired: 108")).toEqual({
      exolizers: 108,
      rounds: 28,
    });
    expect(parseExolizerLine("Round: 28 I Exolizers retired: 112")).toEqual({
      exolizers: 112,
      rounds: 28,
    });
    expect(parseExolizerLine("Round: 28IExolizers leirel: 108")).toEqual({
      exolizers: 108,
      rounds: 28,
    });
  });

  it("ignores other lines and implausible counts", () => {
    expect(parseExolizerLine("NEXT EXOLIZER")).toBeNull();
    expect(parseExolizerLine("Round: 28 | Exolizers retired: 10g")).toBeNull();
    expect(parseExolizerLine("Round: 28 | Exolizers retired: 12")).toBeNull();
    expect(parseExolizerLine("THREAT: MINIMAL")).toBeNull();
  });
});

describe("readExolizersFromScreenshot", () => {
  it("finds the line on a 1080p capture", async () => {
    const sharp = (await import("sharp")).default;
    const svg =
      `<svg width="1920" height="1080"><rect width="1920" height="1080" fill="#1c2630"/>` +
      `<text x="36" y="298" font-family="Arial" font-size="24" fill="#f4f4f4">VOID CASCADE</text>` +
      `<text x="36" y="332" font-family="Arial" font-size="19" fill="#f4f4f4">` +
      `Round: 29 | Exolizers retired: 113</text></svg>`;
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "exo-ocr-")), "shot.png");
    await sharp(Buffer.from(svg)).png().toFile(file);
    try {
      expect(await readExolizersFromScreenshot(file)).toEqual({ exolizers: 113, rounds: 29 });
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  }, 120_000);
});
