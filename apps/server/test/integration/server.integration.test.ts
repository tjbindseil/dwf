import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type {
  ClientToServerMessage,
  ServerToClientMessage,
} from "@dwf/protocol";

const tempDirs: string[] = [];
const servers: Array<{ close: () => Promise<unknown> }> = [];
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5fN6sAAAAASUVORK5CYII=";

interface TestContext {
  app: Awaited<ReturnType<typeof startServer>>;
  roomId: string;
}

let ctx: TestContext;

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

async function createRoom(app: Awaited<ReturnType<typeof startServer>>) {
  const createRes = await app.inject({ method: "POST", url: "/rooms" });
  expect(createRes.statusCode).toBe(200);
  return createRes.json<{ roomId: string; joinUrl: string }>();
}

async function uploadTinyPng(
  app: Awaited<ReturnType<typeof startServer>>,
  roomId: string,
) {
  const validUpload = buildMultipartPayload({
    fieldName: "file",
    filename: "tiny.png",
    contentType: "image/png",
    body: Buffer.from(tinyPngBase64, "base64"),
  });

  return app.inject({
    method: "POST",
    url: `/rooms/${roomId}/image`,
    headers: {
      "content-type": `multipart/form-data; boundary=${validUpload.boundary}`,
    },
    payload: validUpload.payload,
  });
}

async function connectWsClient(opts: {
  app: Awaited<ReturnType<typeof startServer>>;
  roomId: string;
  clientId: string;
  nickname: string;
}) {
  await opts.app.listen({ host: "127.0.0.1", port: 0 });
  const address = opts.app.server.address() as AddressInfo;
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  ws.send(
    JSON.stringify({
      type: "join_room",
      roomId: opts.roomId,
      nickname: opts.nickname,
      clientId: opts.clientId,
    } satisfies ClientToServerMessage),
  );

  await waitForWsMessage(ws, (m) => m.type === "joined");
  return ws;
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

beforeEach(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "dwf-int-"));
  tempDirs.push(dir);
  process.env.DWF_DATA_DIR = dir;

  const app = await startServer();
  const room = await createRoom(app);
  ctx = { app, roomId: room.roomId };
});

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
    const bootRes = await ctx.app.inject({
      method: "GET",
      url: `/rooms/${ctx.roomId}/bootstrap`,
    });
    expect(bootRes.statusCode).toBe(200);

    const boot = bootRes.json<{
      roomState: { roomId: string; serverSeq: number; strokes: unknown[] };
    }>();

    expect(boot.roomState.roomId).toBe(ctx.roomId);
    expect(boot.roomState.serverSeq).toBe(0);
    expect(boot.roomState.strokes).toHaveLength(0);
  });

  it("validates image upload and stores metadata", async () => {
    const invalidUpload = buildMultipartPayload({
      fieldName: "file",
      filename: "note.txt",
      contentType: "text/plain",
      body: Buffer.from("hello", "utf8"),
    });

    const invalidRes = await ctx.app.inject({
      method: "POST",
      url: `/rooms/${ctx.roomId}/image`,
      headers: {
        "content-type": `multipart/form-data; boundary=${invalidUpload.boundary}`,
      },
      payload: invalidUpload.payload,
    });
    expect(invalidRes.statusCode).toBe(400);

    const uploadRes = await uploadTinyPng(ctx.app, ctx.roomId);
    expect(uploadRes.statusCode).toBe(200);

    const bootRes = await ctx.app.inject({
      method: "GET",
      url: `/rooms/${ctx.roomId}/bootstrap`,
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

    const ws = await connectWsClient({
      app: ctx.app,
      roomId: ctx.roomId,
      clientId: "c1",
      nickname: "alice",
    });

    ws.send(
      JSON.stringify({
        type: "stroke_start",
        roomId: ctx.roomId,
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
        roomId: ctx.roomId,
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
    const uploadRes = await uploadTinyPng(ctx.app, ctx.roomId);
    expect(uploadRes.statusCode).toBe(200);

    await ctx.app.close();
    servers.pop();

    const second = await startServer();
    const bootRes = await second.inject({
      method: "GET",
      url: `/rooms/${ctx.roomId}/bootstrap`,
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
