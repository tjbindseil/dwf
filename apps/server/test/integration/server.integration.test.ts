import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type {
  ClientToServerMessage,
  ServerToClientMessage,
} from "@dwf/protocol";

const tempDirs: string[] = [];
const servers: Array<{ close: () => Promise<unknown> }> = [];

function buildMultipartPayload(file: {
  fieldName: string;
  filename: string;
  contentType: string;
  body: Buffer;
}): { boundary: string; payload: Buffer } {
  const boundary = `----dwf-${Date.now()}`;
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    "utf8",
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    boundary,
    payload: Buffer.concat([header, file.body, footer]),
  };
}

async function startServer() {
  const mod = await import("../../src/server.js");
  const app = await mod.buildServer();
  servers.push(app);
  return app;
}

function waitForWsMessage(
  ws: WebSocket,
  predicate: (msg: ServerToClientMessage) => boolean,
  timeoutMs = 3000,
): Promise<ServerToClientMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for WS message"));
    }, timeoutMs);

    const onMessage = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as ServerToClientMessage;
      if (!predicate(msg)) {
        return;
      }
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(msg);
    };

    ws.on("message", onMessage);
  });
}

function canBindLocalhost(): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(0, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((app) => app.close()));
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
  delete process.env.DWF_DATA_DIR;
  vi.resetModules();
});

describe("server integration", () => {
  it("creates room and bootstraps state", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-int-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const app = await startServer();

    const createRes = await app.inject({ method: "POST", url: "/rooms" });
    expect(createRes.statusCode).toBe(200);
    const created = createRes.json<{ roomId: string; joinUrl: string }>();
    expect(created.roomId).toBeTruthy();
    expect(created.joinUrl).toBe(`/room/${created.roomId}`);

    const bootRes = await app.inject({
      method: "GET",
      url: `/rooms/${created.roomId}/bootstrap`,
    });
    expect(bootRes.statusCode).toBe(200);
    const boot = bootRes.json<{
      roomState: { roomId: string; serverSeq: number; strokes: unknown[] };
    }>();
    expect(boot.roomState.roomId).toBe(created.roomId);
    expect(boot.roomState.serverSeq).toBe(0);
    expect(boot.roomState.strokes).toHaveLength(0);
  });

  it("validates image upload and stores metadata", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-int-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const app = await startServer();

    const createRes = await app.inject({ method: "POST", url: "/rooms" });
    const created = createRes.json<{ roomId: string }>();

    const invalidUpload = buildMultipartPayload({
      fieldName: "file",
      filename: "note.txt",
      contentType: "text/plain",
      body: Buffer.from("hello", "utf8"),
    });

    const invalidRes = await app.inject({
      method: "POST",
      url: `/rooms/${created.roomId}/image`,
      headers: {
        "content-type": `multipart/form-data; boundary=${invalidUpload.boundary}`,
      },
      payload: invalidUpload.payload,
    });
    expect(invalidRes.statusCode).toBe(400);

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5fN6sAAAAASUVORK5CYII=";
    const validUpload = buildMultipartPayload({
      fieldName: "file",
      filename: "tiny.png",
      contentType: "image/png",
      body: Buffer.from(pngBase64, "base64"),
    });

    const uploadRes = await app.inject({
      method: "POST",
      url: `/rooms/${created.roomId}/image`,
      headers: {
        "content-type": `multipart/form-data; boundary=${validUpload.boundary}`,
      },
      payload: validUpload.payload,
    });
    expect(uploadRes.statusCode).toBe(200);

    const bootRes = await app.inject({
      method: "GET",
      url: `/rooms/${created.roomId}/bootstrap`,
    });
    const boot = bootRes.json<{
      roomState: {
        imageMeta: null | {
          fileName: string;
          mimeType: string;
          width: number;
          height: number;
          path: string;
        };
      };
    }>();

    expect(boot.roomState.imageMeta).not.toBeNull();
    expect(boot.roomState.imageMeta?.mimeType).toBe("image/png");
    expect(boot.roomState.imageMeta?.width).toBe(1);
    expect(boot.roomState.imageMeta?.height).toBe(1);
    expect(boot.roomState.imageMeta?.path.startsWith("/images/")).toBe(true);
  });

  it("broadcasts websocket operations with server sequence", async () => {
    if (!(await canBindLocalhost())) {
      return;
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-int-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const app = await startServer();

    const createRes = await app.inject({ method: "POST", url: "/rooms" });
    const created = createRes.json<{ roomId: string }>();

    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    ws.send(
      JSON.stringify({
        type: "join_room",
        roomId: created.roomId,
        nickname: "alice",
        clientId: "c1",
      } satisfies ClientToServerMessage),
    );

    const joined = await waitForWsMessage(ws, (m) => m.type === "joined");
    expect(joined.type).toBe("joined");

    ws.send(
      JSON.stringify({
        type: "stroke_start",
        roomId: created.roomId,
        strokeId: "s1",
        clientId: "c1",
        tool: "brush",
        style: { color: "#000", size: 5 },
        point: { x: 10, y: 20 },
        clientTs: Date.now(),
      } satisfies ClientToServerMessage),
    );

    const firstOp = await waitForWsMessage(
      ws,
      (m) => m.type === "op_applied" && m.serverSeq === 1,
    );
    expect(firstOp.type).toBe("op_applied");

    ws.send(
      JSON.stringify({
        type: "stroke_end",
        roomId: created.roomId,
        strokeId: "s1",
        clientId: "c1",
        clientTs: Date.now(),
      } satisfies ClientToServerMessage),
    );

    const secondOp = await waitForWsMessage(
      ws,
      (m) => m.type === "op_applied" && m.serverSeq === 2,
    );
    expect(secondOp.type).toBe("op_applied");

    ws.close();
    await new Promise((resolve) => ws.once("close", resolve));
  });

  it("persists room metadata across server restart", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-int-"));
    tempDirs.push(dir);
    process.env.DWF_DATA_DIR = dir;

    const first = await startServer();
    const createRes = await first.inject({ method: "POST", url: "/rooms" });
    const created = createRes.json<{ roomId: string }>();

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5fN6sAAAAASUVORK5CYII=";
    const validUpload = buildMultipartPayload({
      fieldName: "file",
      filename: "tiny.png",
      contentType: "image/png",
      body: Buffer.from(pngBase64, "base64"),
    });

    const uploadRes = await first.inject({
      method: "POST",
      url: `/rooms/${created.roomId}/image`,
      headers: {
        "content-type": `multipart/form-data; boundary=${validUpload.boundary}`,
      },
      payload: validUpload.payload,
    });
    expect(uploadRes.statusCode).toBe(200);

    await first.close();
    servers.pop();

    const second = await startServer();
    const bootRes = await second.inject({
      method: "GET",
      url: `/rooms/${created.roomId}/bootstrap`,
    });
    expect(bootRes.statusCode).toBe(200);
    const boot = bootRes.json<{
      roomState: {
        imageMeta: null | { fileName: string; width: number; height: number };
      };
    }>();

    expect(boot.roomState.imageMeta?.fileName).toBe("tiny.png");
    expect(boot.roomState.imageMeta?.width).toBe(1);
    expect(boot.roomState.imageMeta?.height).toBe(1);
  });
});
