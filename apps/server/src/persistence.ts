import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RoomState } from "@dwf/protocol";

const ROOM_DIR = path.resolve(process.cwd(), "data/rooms");

export async function saveRoomState(state: RoomState): Promise<void> {
  await mkdir(ROOM_DIR, { recursive: true });
  const filePath = path.join(ROOM_DIR, `${state.roomId}.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function loadRoomState(roomId: string): Promise<RoomState | null> {
  try {
    const filePath = path.join(ROOM_DIR, `${roomId}.json`);
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as RoomState;
  } catch {
    return null;
  }
}
