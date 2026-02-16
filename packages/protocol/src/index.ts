export type Tool = "brush" | "eraser";

export interface Point {
  x: number;
  y: number;
}

export interface StrokeStyle {
  color: string;
  size: number;
}

export interface Stroke {
  strokeId: string;
  clientId: string;
  tool: Tool;
  style: StrokeStyle;
  points: Point[];
  startedAt: number;
  endedAt?: number;
  visible: boolean;
}

export interface ImageMeta {
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  path: string;
}

export interface RoomState {
  roomId: string;
  imageMeta: ImageMeta | null;
  serverSeq: number;
  strokes: Stroke[];
  users: Array<{ clientId: string; nickname: string }>;
}

export type ClientToServerMessage =
  | {
      type: "join_room";
      roomId: string;
      nickname: string;
      clientId: string;
      lastServerSeq?: number;
    }
  | {
      type: "stroke_start";
      roomId: string;
      strokeId: string;
      clientId: string;
      tool: Tool;
      style: StrokeStyle;
      point: Point;
      clientTs: number;
    }
  | {
      type: "stroke_point";
      roomId: string;
      strokeId: string;
      clientId: string;
      point: Point;
      clientTs: number;
    }
  | {
      type: "stroke_end";
      roomId: string;
      strokeId: string;
      clientId: string;
      clientTs: number;
    }
  | {
      type: "undo";
      roomId: string;
      clientId: string;
    }
  | {
      type: "redo";
      roomId: string;
      clientId: string;
    };

export type ServerToClientMessage =
  | {
      type: "joined";
      roomState: RoomState;
    }
  | {
      type: "op_applied";
      serverSeq: number;
      op: RoomOp;
    }
  | {
      type: "presence";
      users: Array<{ clientId: string; nickname: string }>;
    }
  | {
      type: "error";
      code: string;
      message: string;
    };

export type RoomOp =
  | { type: "stroke_created"; stroke: Stroke }
  | { type: "stroke_point_added"; strokeId: string; point: Point }
  | { type: "stroke_completed"; strokeId: string; endedAt: number }
  | { type: "stroke_visibility"; strokeId: string; visible: boolean; byClientId: string };

export interface CreateRoomResponse {
  roomId: string;
  joinUrl: string;
}

export interface BootstrapResponse {
  roomState: RoomState;
}
