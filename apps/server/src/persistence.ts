import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RoomState } from "@dwf/protocol";
import { roomsDir } from "./paths.js";

export async function saveRoomState(state: RoomState): Promise<void> {
  await mkdir(roomsDir, { recursive: true });
  const filePath = path.join(roomsDir, `${state.roomId}.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function loadRoomState(roomId: string): Promise<RoomState | null> {
  try {
    const filePath = path.join(roomsDir, `${roomId}.json`);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as RoomState;
  } catch {
    return null;
  }
}
