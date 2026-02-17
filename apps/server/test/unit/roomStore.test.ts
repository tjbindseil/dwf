import { describe, expect, it } from "vitest";
import { RoomStore, createStrokeStart } from "../../src/roomStore.js";

describe("RoomStore", () => {
  it("applies stroke lifecycle and sequencing", () => {
    const store = new RoomStore();
    store.getOrCreateRoom("r1");

    const start = store.applyMessage(
      createStrokeStart(
        "r1",
        "s1",
        "c1",
        { x: 1, y: 2 },
        "brush",
        { color: "#000", size: 4 },
        Date.now(),
      ),
    );
    expect(start?.serverSeq).toBe(1);

    const point = store.applyMessage({
      type: "stroke_point",
      roomId: "r1",
      strokeId: "s1",
      clientId: "c1",
      point: { x: 3, y: 4 },
      clientTs: Date.now(),
    });
    expect(point?.serverSeq).toBe(2);

    const end = store.applyMessage({
      type: "stroke_end",
      roomId: "r1",
      strokeId: "s1",
      clientId: "c1",
      clientTs: Date.now(),
    });
    expect(end?.serverSeq).toBe(3);
  });

  it("undo/redo toggles visibility for owning user", () => {
    const store = new RoomStore();
    store.getOrCreateRoom("r2");

    store.applyMessage(
      createStrokeStart(
        "r2",
        "s1",
        "c1",
        { x: 1, y: 1 },
        "brush",
        { color: "#111", size: 2 },
        Date.now(),
      ),
    );

    const undo = store.applyMessage({
      type: "undo",
      roomId: "r2",
      clientId: "c1",
    });
    expect(undo?.op.type).toBe("stroke_visibility");
    if (undo?.op.type === "stroke_visibility") {
      expect(undo.op.visible).toBe(false);
    }

    const redo = store.applyMessage({
      type: "redo",
      roomId: "r2",
      clientId: "c1",
    });
    expect(redo?.op.type).toBe("stroke_visibility");
    if (redo?.op.type === "stroke_visibility") {
      expect(redo.op.visible).toBe(true);
    }
  });

  it("ignores duplicate stroke start with same strokeId", () => {
    const store = new RoomStore();
    store.getOrCreateRoom("r3");

    const first = store.applyMessage(
      createStrokeStart(
        "r3",
        "dup",
        "c1",
        { x: 0, y: 0 },
        "brush",
        { color: "#000", size: 4 },
        1,
      ),
    );
    const second = store.applyMessage(
      createStrokeStart(
        "r3",
        "dup",
        "c1",
        { x: 5, y: 5 },
        "brush",
        { color: "#000", size: 4 },
        2,
      ),
    );

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(store.getRoomState("r3")?.strokes).toHaveLength(1);
  });

  it("returns null for undo/redo when stacks are empty", () => {
    const store = new RoomStore();
    store.getOrCreateRoom("r4");

    expect(
      store.applyMessage({ type: "undo", roomId: "r4", clientId: "c1" }),
    ).toBeNull();
    expect(
      store.applyMessage({ type: "redo", roomId: "r4", clientId: "c1" }),
    ).toBeNull();
  });

  it("does not allow user to undo another user's stroke", () => {
    const store = new RoomStore();
    store.getOrCreateRoom("r5");

    store.applyMessage(
      createStrokeStart(
        "r5",
        "s1",
        "owner",
        { x: 0, y: 0 },
        "brush",
        { color: "#000", size: 4 },
        1,
      ),
    );

    const undoOther = store.applyMessage({
      type: "undo",
      roomId: "r5",
      clientId: "other",
    });

    expect(undoOther).toBeNull();
    expect(store.getRoomState("r5")?.strokes[0]?.visible).toBe(true);
  });
});
