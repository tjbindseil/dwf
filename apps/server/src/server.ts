import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { imageSize } from "image-size";
import { nanoid } from "nanoid";
import { WebSocket, WebSocketServer } from "ws";
import type {
  ClientToServerMessage,
  CreateRoomResponse,
  ServerToClientMessage,
} from "@dwf/protocol";
import { loadRoomState, saveRoomState } from "./persistence.js";
import { imagesDir } from "./paths.js";
import { RoomStore } from "./roomStore.js";

export async function buildServer() {
  const app = Fastify({ logger: true });
  const store = new RoomStore();
  const roomClients = new Map<string, Set<WebSocket>>();
  const clientRoom = new Map<WebSocket, { roomId: string; clientId: string }>();

  await mkdir(imagesDir, { recursive: true });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: imagesDir,
    prefix: "/images/",
  });

  app.get("/health", async () => ({ ok: true }));

  app.post<{ Reply: CreateRoomResponse }>("/rooms", async (_req, reply) => {
    const roomId = nanoid(8);
    store.getOrCreateRoom(roomId);
    await saveRoomState(store.getOrCreateRoom(roomId));

    return reply.send({ roomId, joinUrl: `/room/${roomId}` });
  });

  app.post<{ Params: { roomId: string } }>(
    "/rooms/:roomId/image",
    async (req, reply) => {
      const { roomId } = req.params;
      store.getOrCreateRoom(roomId);

      const part = await req.file();
      if (!part) {
        return reply.code(400).send({ error: "No file provided" });
      }

      if (!["image/png", "image/jpeg", "image/webp"].includes(part.mimetype)) {
        return reply
          .code(400)
          .send({ error: "Only PNG, JPEG, and WEBP are allowed" });
      }

      await mkdir(imagesDir, { recursive: true });

      const fileName = `${roomId}-${Date.now()}-${part.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const filePath = path.join(imagesDir, fileName);
      await pipeline(part.file, createWriteStream(filePath));

      const dimensions = imageSize(filePath);
      if (!dimensions.width || !dimensions.height) {
        return reply
          .code(400)
          .send({ error: "Could not read image dimensions" });
      }

      if (dimensions.width > 4096 || dimensions.height > 4096) {
        return reply.code(400).send({ error: "Image max dimension is 4096px" });
      }

      store.setImage(roomId, {
        fileName: part.filename,
        mimeType: part.mimetype,
        width: dimensions.width,
        height: dimensions.height,
        path: `/images/${fileName}`,
      });

      const roomState = store.getRoomState(roomId);
      if (roomState) {
        await saveRoomState(roomState);
      }

      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { roomId: string } }>(
    "/rooms/:roomId/bootstrap",
    async (req, reply) => {
      const { roomId } = req.params;
      const roomState =
        store.getRoomState(roomId) ?? (await loadRoomState(roomId));

      if (!roomState) {
        return reply.code(404).send({ error: "Room not found" });
      }

      store.hydrateRoom(roomState);
      return reply.send({ roomState });
    },
  );

  const server = app.server;
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws);
    });
  });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientToServerMessage;

        if (msg.type === "join_room") {
          const roomState =
            store.getRoomState(msg.roomId) ?? (await loadRoomState(msg.roomId));
          if (roomState) {
            store.hydrateRoom(roomState);
          }

          const state = store.addUser(msg.roomId, msg.clientId, msg.nickname);
          clientRoom.set(ws, { roomId: msg.roomId, clientId: msg.clientId });

          const roomSet = roomClients.get(msg.roomId) ?? new Set();
          roomSet.add(ws);
          roomClients.set(msg.roomId, roomSet);

          ws.send(
            JSON.stringify({
              type: "joined",
              roomState: state,
            } satisfies ServerToClientMessage),
          );
          broadcast(msg.roomId, {
            type: "presence",
            users: state.users,
          });

          await saveRoomState(state);
          return;
        }

        const applied = store.applyMessage(msg);
        if (!applied || !("roomId" in msg)) {
          return;
        }

        const state = store.getRoomState(msg.roomId);
        if (state) {
          await saveRoomState(state);
        }

        broadcast(msg.roomId, {
          type: "op_applied",
          serverSeq: applied.serverSeq,
          op: applied.op,
        });
      } catch {
        ws.send(
          JSON.stringify({
            type: "error",
            code: "BAD_MESSAGE",
            message: "Invalid message payload",
          } satisfies ServerToClientMessage),
        );
      }
    });

    ws.on("close", async () => {
      const info = clientRoom.get(ws);
      if (!info) {
        return;
      }

      clientRoom.delete(ws);
      const set = roomClients.get(info.roomId);
      set?.delete(ws);
      store.removeUser(info.clientId);
      const state = store.getRoomState(info.roomId);
      if (state) {
        broadcast(info.roomId, { type: "presence", users: state.users });
        await saveRoomState(state);
      }
    });
  });

  function broadcast(roomId: string, message: ServerToClientMessage) {
    const clients = roomClients.get(roomId);
    if (!clients) {
      return;
    }

    const encoded = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(encoded);
      }
    }
  }

  return app;
}
