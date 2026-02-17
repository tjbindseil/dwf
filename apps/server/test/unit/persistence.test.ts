import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  delete process.env.DWF_DATA_DIR;
  vi.resetModules();
});

describe("persistence", () => {
  it("saves and loads room state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-test-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const { saveRoomState, loadRoomState } = await import(
      "../../src/persistence.js"
    );

    const state = {
      roomId: "room1",
      imageMeta: null,
      serverSeq: 2,
      strokes: [],
      users: [{ clientId: "c1", nickname: "n1" }],
    };

    await saveRoomState(state);
    const loaded = await loadRoomState("room1");

    expect(loaded).toEqual(state);
  });

  it("returns null for missing room", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-test-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const { loadRoomState } = await import("../../src/persistence.js");

    await expect(loadRoomState("missing")).resolves.toBeNull();
  });
});
