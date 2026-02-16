import test from "node:test";
import assert from "node:assert/strict";
import { RoomStore, createStrokeStart } from "../src/roomStore.js";

test("applies stroke lifecycle and sequencing", () => {
  const store = new RoomStore();
  store.getOrCreateRoom("r1");

  const start = store.applyMessage(
    createStrokeStart("r1", "s1", "c1", { x: 1, y: 2 }, "brush", { color: "#000", size: 4 }, Date.now())
  );
  assert.ok(start);
  assert.equal(start.serverSeq, 1);

  const point = store.applyMessage({
    type: "stroke_point",
    roomId: "r1",
    strokeId: "s1",
    clientId: "c1",
    point: { x: 3, y: 4 },
    clientTs: Date.now()
  });
  assert.ok(point);
  assert.equal(point.serverSeq, 2);

  const end = store.applyMessage({
    type: "stroke_end",
    roomId: "r1",
    strokeId: "s1",
    clientId: "c1",
    clientTs: Date.now()
  });
  assert.ok(end);
  assert.equal(end.serverSeq, 3);
});

test("undo/redo toggles visibility for owning user", () => {
  const store = new RoomStore();
  store.getOrCreateRoom("r2");

  store.applyMessage(
    createStrokeStart("r2", "s1", "c1", { x: 1, y: 1 }, "brush", { color: "#111", size: 2 }, Date.now())
  );

  const undo = store.applyMessage({ type: "undo", roomId: "r2", clientId: "c1" });
  assert.ok(undo);
  assert.equal(undo.op.type, "stroke_visibility");
  assert.equal(undo.op.visible, false);

  const redo = store.applyMessage({ type: "redo", roomId: "r2", clientId: "c1" });
  assert.ok(redo);
  assert.equal(redo.op.type, "stroke_visibility");
  assert.equal(redo.op.visible, true);
});
