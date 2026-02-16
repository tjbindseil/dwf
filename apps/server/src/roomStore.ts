import type {
  ClientToServerMessage,
  ImageMeta,
  Point,
  RoomOp,
  RoomState,
  Stroke,
  StrokeStyle,
  Tool
} from "@dwf/protocol";

interface RoomInternals {
  state: RoomState;
  appliedPoints: Set<string>;
  undoStackByClient: Map<string, string[]>;
  redoStackByClient: Map<string, string[]>;
}

export interface ApplyResult {
  serverSeq: number;
  op: RoomOp;
}

export class RoomStore {
  private rooms = new Map<string, RoomInternals>();

  getOrCreateRoom(roomId: string): RoomState {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        state: {
          roomId,
          imageMeta: null,
          serverSeq: 0,
          strokes: [],
          users: []
        },
        appliedPoints: new Set(),
        undoStackByClient: new Map(),
        redoStackByClient: new Map()
      };
      this.rooms.set(roomId, room);
    }
    return room.state;
  }

  setImage(roomId: string, imageMeta: ImageMeta): void {
    this.getOrCreateRoom(roomId).imageMeta = imageMeta;
  }

  addUser(roomId: string, clientId: string, nickname: string): RoomState {
    const state = this.getOrCreateRoom(roomId);
    const existing = state.users.find((u) => u.clientId === clientId);
    if (!existing) {
      state.users.push({ clientId, nickname });
    }
    return state;
  }

  removeUser(clientId: string): void {
    for (const { state } of this.rooms.values()) {
      state.users = state.users.filter((u) => u.clientId !== clientId);
    }
  }

  applyMessage(msg: ClientToServerMessage): ApplyResult | null {
    if (!("roomId" in msg)) {
      return null;
    }

    const room = this.rooms.get(msg.roomId);
    if (!room) {
      return null;
    }

    switch (msg.type) {
      case "stroke_start": {
        const existing = room.state.strokes.find((s) => s.strokeId === msg.strokeId);
        if (existing) {
          return null;
        }

        const stroke: Stroke = {
          strokeId: msg.strokeId,
          clientId: msg.clientId,
          tool: msg.tool,
          style: msg.style,
          points: [msg.point],
          startedAt: msg.clientTs,
          visible: true
        };

        room.state.strokes.push(stroke);
        this.pushUndo(room, msg.clientId, msg.strokeId);
        const op: RoomOp = { type: "stroke_created", stroke };
        return this.bumpSeq(room.state, op);
      }
      case "stroke_point": {
        const stroke = room.state.strokes.find((s) => s.strokeId === msg.strokeId);
        if (!stroke) {
          return null;
        }

        const key = `${msg.strokeId}:${msg.point.x}:${msg.point.y}:${msg.clientTs}`;
        if (room.appliedPoints.has(key)) {
          return null;
        }
        room.appliedPoints.add(key);

        stroke.points.push(msg.point);
        const op: RoomOp = { type: "stroke_point_added", strokeId: msg.strokeId, point: msg.point };
        return this.bumpSeq(room.state, op);
      }
      case "stroke_end": {
        const stroke = room.state.strokes.find((s) => s.strokeId === msg.strokeId);
        if (!stroke || stroke.endedAt) {
          return null;
        }
        stroke.endedAt = msg.clientTs;
        const op: RoomOp = { type: "stroke_completed", strokeId: msg.strokeId, endedAt: msg.clientTs };
        return this.bumpSeq(room.state, op);
      }
      case "undo": {
        const strokeId = this.popUndo(room, msg.clientId);
        if (!strokeId) {
          return null;
        }
        const stroke = room.state.strokes.find((s) => s.strokeId === strokeId);
        if (!stroke || !stroke.visible) {
          return null;
        }
        stroke.visible = false;
        this.pushRedo(room, msg.clientId, strokeId);
        const op: RoomOp = {
          type: "stroke_visibility",
          strokeId,
          visible: false,
          byClientId: msg.clientId
        };
        return this.bumpSeq(room.state, op);
      }
      case "redo": {
        const strokeId = this.popRedo(room, msg.clientId);
        if (!strokeId) {
          return null;
        }
        const stroke = room.state.strokes.find((s) => s.strokeId === strokeId);
        if (!stroke || stroke.visible) {
          return null;
        }
        stroke.visible = true;
        this.pushUndo(room, msg.clientId, strokeId);
        const op: RoomOp = {
          type: "stroke_visibility",
          strokeId,
          visible: true,
          byClientId: msg.clientId
        };
        return this.bumpSeq(room.state, op);
      }
      default:
        return null;
    }
  }

  getRoomState(roomId: string): RoomState | null {
    return this.rooms.get(roomId)?.state ?? null;
  }

  hydrateRoom(state: RoomState): void {
    this.rooms.set(state.roomId, {
      state,
      appliedPoints: new Set(),
      undoStackByClient: new Map(),
      redoStackByClient: new Map()
    });

    const room = this.rooms.get(state.roomId);
    if (!room) {
      return;
    }

    for (const stroke of state.strokes) {
      this.pushUndo(room, stroke.clientId, stroke.strokeId);
      for (const p of stroke.points) {
        room.appliedPoints.add(`${stroke.strokeId}:${p.x}:${p.y}:${stroke.startedAt}`);
      }
    }
  }

  private bumpSeq(state: RoomState, op: RoomOp): ApplyResult {
    state.serverSeq += 1;
    return {
      serverSeq: state.serverSeq,
      op
    };
  }

  private pushUndo(room: RoomInternals, clientId: string, strokeId: string): void {
    const stack = room.undoStackByClient.get(clientId) ?? [];
    stack.push(strokeId);
    room.undoStackByClient.set(clientId, stack);
    room.redoStackByClient.set(clientId, []);
  }

  private popUndo(room: RoomInternals, clientId: string): string | undefined {
    const stack = room.undoStackByClient.get(clientId);
    return stack?.pop();
  }

  private pushRedo(room: RoomInternals, clientId: string, strokeId: string): void {
    const stack = room.redoStackByClient.get(clientId) ?? [];
    stack.push(strokeId);
    room.redoStackByClient.set(clientId, stack);
  }

  private popRedo(room: RoomInternals, clientId: string): string | undefined {
    const stack = room.redoStackByClient.get(clientId);
    return stack?.pop();
  }
}

export function createStrokeStart(
  roomId: string,
  strokeId: string,
  clientId: string,
  point: Point,
  tool: Tool,
  style: StrokeStyle,
  clientTs: number
): ClientToServerMessage {
  return {
    type: "stroke_start",
    roomId,
    strokeId,
    clientId,
    point,
    tool,
    style,
    clientTs
  };
}
