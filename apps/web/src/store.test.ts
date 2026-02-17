import { describe, expect, it } from "vitest";
import { strokesForRender } from "./store";

describe("strokesForRender", () => {
  it("filters hidden and empty strokes", () => {
    const output = strokesForRender([
      {
        strokeId: "a",
        clientId: "c1",
        tool: "brush",
        style: { color: "#000", size: 4 },
        points: [],
        startedAt: 1,
        visible: true,
      },
      {
        strokeId: "b",
        clientId: "c1",
        tool: "brush",
        style: { color: "#000", size: 4 },
        points: [{ x: 1, y: 2 }],
        startedAt: 1,
        visible: false,
      },
      {
        strokeId: "c",
        clientId: "c2",
        tool: "eraser",
        style: { color: "#000", size: 4 },
        points: [{ x: 5, y: 8 }],
        startedAt: 1,
        visible: true,
      },
    ]);

    expect(output).toHaveLength(1);
    expect(output[0]?.strokeId).toBe("c");
  });
});
