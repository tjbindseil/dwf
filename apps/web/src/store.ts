import { create } from "zustand";
import type {
  BootstrapResponse,
  ClientToServerMessage,
  RoomOp,
  RoomState,
  ServerToClientMessage,
  Stroke
} from "@dwf/protocol";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

interface AppState {
  apiUrl: string;
  connectionState: ConnectionState;
  roomId: string;
  nickname: string;
  clientId: string;
  roomState: RoomState | null;
  ws: WebSocket | null;
  setNickname: (value: string) => void;
  setRoomId: (value: string) => void;
  createRoom: () => Promise<void>;
  joinRoom: () => Promise<void>;
  uploadImage: (file: File) => Promise<void>;
  send: (msg: ClientToServerMessage) => void;
  applyOp: (op: RoomOp, serverSeq: number) => void;
}

function makeClientId(): string {
  return `c_${Math.random().toString(36).slice(2, 11)}`;
}

export const useAppStore = create<AppState>((set, get) => ({
  apiUrl: API_URL,
  connectionState: "idle",
  roomId: "",
  nickname: "",
  clientId: makeClientId(),
  roomState: null,
  ws: null,
  setNickname: (nickname) => set({ nickname }),
  setRoomId: (roomId) => set({ roomId }),

  createRoom: async () => {
    const response = await fetch(`${API_URL}/rooms`, { method: "POST" });
    if (!response.ok) {
      throw new Error("Failed to create room");
    }
    const data = (await response.json()) as { roomId: string };
    set({ roomId: data.roomId });
  },

  joinRoom: async () => {
    const { roomId, nickname, clientId, ws } = get();
    if (!roomId || !nickname) {
      throw new Error("Room ID and nickname are required");
    }

    ws?.close();
    set({ connectionState: "connecting" });
    const bootstrapRes = await fetch(`${API_URL}/rooms/${roomId}/bootstrap`);

    if (!bootstrapRes.ok) {
      throw new Error("Room does not exist or is unavailable");
    }

    const bootstrap = (await bootstrapRes.json()) as BootstrapResponse;
    set({ roomState: bootstrap.roomState });

    const wsUrl = API_URL.replace("http", "ws") + "/ws";
    const ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      set({ connectionState: "connected" });
      ws.send(
        JSON.stringify({
          type: "join_room",
          roomId,
          nickname,
          clientId
        } satisfies ClientToServerMessage)
      );
    });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerToClientMessage;

      if (message.type === "joined") {
        set({ roomState: message.roomState });
      }

      if (message.type === "presence") {
        set((state) => {
          if (!state.roomState) return state;
          return {
            roomState: {
              ...state.roomState,
              users: message.users
            }
          };
        });
      }

      if (message.type === "op_applied") {
        get().applyOp(message.op, message.serverSeq);
      }
    });

    ws.addEventListener("close", () => {
      set({ connectionState: "idle", ws: null });
    });

    ws.addEventListener("error", () => {
      set({ connectionState: "error" });
    });

    set({ ws });
  },

  uploadImage: async (file) => {
    const { roomId } = get();
    if (!roomId) {
      throw new Error("Create or join room first");
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_URL}/rooms/${roomId}/image`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error("Failed to upload image");
    }

    const bootstrapRes = await fetch(`${API_URL}/rooms/${roomId}/bootstrap`);
    if (bootstrapRes.ok) {
      const bootstrap = (await bootstrapRes.json()) as BootstrapResponse;
      set({ roomState: bootstrap.roomState });
    }
  },

  send: (msg) => {
    const { ws, connectionState } = get();
    if (!ws || connectionState !== "connected") {
      return;
    }
    ws.send(JSON.stringify(msg));
  },

  applyOp: (op, serverSeq) => {
    set((state) => {
      if (!state.roomState) {
        return state;
      }

      const nextState = { ...state.roomState, strokes: [...state.roomState.strokes] };

      switch (op.type) {
        case "stroke_created":
          nextState.strokes.push(op.stroke);
          break;
        case "stroke_point_added": {
          const stroke = nextState.strokes.find((s) => s.strokeId === op.strokeId);
          if (!stroke) break;
          stroke.points = [...stroke.points, op.point];
          break;
        }
        case "stroke_completed": {
          const stroke = nextState.strokes.find((s) => s.strokeId === op.strokeId);
          if (!stroke) break;
          stroke.endedAt = op.endedAt;
          break;
        }
        case "stroke_visibility": {
          const stroke = nextState.strokes.find((s) => s.strokeId === op.strokeId);
          if (!stroke) break;
          stroke.visible = op.visible;
          break;
        }
      }

      nextState.serverSeq = serverSeq;
      return { roomState: nextState };
    });
  }
}));

export function strokesForRender(strokes: Stroke[]): Stroke[] {
  return strokes.filter((s) => s.visible && s.points.length > 0);
}
