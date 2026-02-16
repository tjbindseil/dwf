import { useEffect, useRef, useState } from "react";
import { Layer, Line, Stage, Image as KonvaImage } from "react-konva";
import type { ClientToServerMessage, Stroke, Tool } from "@dwf/protocol";
import { useAppStore, strokesForRender } from "./store";

const COLORS = ["#0a0a0a", "#e03131", "#1c7ed6", "#2b8a3e", "#f08c00"];

interface DraftStroke {
  strokeId: string;
  tool: Tool;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
}

function loadImage(src: string | undefined): HTMLImageElement | null {
  if (!src) {
    return null;
  }
  const image = new window.Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  return image;
}

function flattenPoints(points: Array<{ x: number; y: number }>): number[] {
  return points.flatMap((p) => [p.x, p.y]);
}

function strokeToLine(stroke: Stroke): number[] {
  return stroke.points.flatMap((p) => [p.x, p.y]);
}

export function App() {
  const {
    apiUrl,
    roomId,
    nickname,
    roomState,
    connectionState,
    clientId,
    setRoomId,
    setNickname,
    createRoom,
    joinRoom,
    send,
    uploadImage
  } = useAppStore();
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(6);
  const [draft, setDraft] = useState<DraftStroke | null>(null);
  const stageRef = useRef<any>(null);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);

  const imagePath = roomState?.imageMeta?.path;

  useEffect(() => {
    if (!imagePath) {
      setImageObj(null);
      return;
    }
    const image = loadImage(`${apiUrl}${imagePath}`);
    if (!image) {
      return;
    }
    image.onload = () => setImageObj(image);
  }, [apiUrl, imagePath]);

  const visibleStrokes = strokesForRender(roomState?.strokes ?? []);

  function startStroke(point: { x: number; y: number }) {
    if (!roomState || connectionState !== "connected") {
      return;
    }

    const strokeId = `${clientId}_${Date.now()}`;
    setDraft({ strokeId, tool, color, size, points: [point] });

    const msg: ClientToServerMessage = {
      type: "stroke_start",
      roomId: roomState.roomId,
      strokeId,
      clientId,
      tool,
      style: { color, size },
      point,
      clientTs: Date.now()
    };
    send(msg);
  }

  function appendPoint(point: { x: number; y: number }) {
    if (!draft || !roomState) {
      return;
    }

    setDraft((prev) => (prev ? { ...prev, points: [...prev.points, point] } : prev));
    send({
      type: "stroke_point",
      roomId: roomState.roomId,
      strokeId: draft.strokeId,
      clientId,
      point,
      clientTs: Date.now()
    });
  }

  function endStroke() {
    if (!draft || !roomState) {
      return;
    }

    send({
      type: "stroke_end",
      roomId: roomState.roomId,
      strokeId: draft.strokeId,
      clientId,
      clientTs: Date.now()
    });
    setDraft(null);
  }

  function pointerPosition() {
    const stage = stageRef.current;
    if (!stage) return null;
    return stage.getPointerPosition();
  }

  async function onUploadSelected(file: File | null) {
    if (!file) return;
    await uploadImage(file);
  }

  function exportPng() {
    const stage = stageRef.current;
    if (!stage) return;
    const url = stage.toDataURL({ pixelRatio: 2 });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roomId || "drawing"}.png`;
    a.click();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Live Draw</h1>
        <p className="muted">Realtime collaborative photo markup</p>

        <label>
          Nickname
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Your name" />
        </label>

        <div className="row">
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="Room ID" />
          <button onClick={() => void createRoom()}>Create</button>
        </div>

        <button onClick={() => void joinRoom()} disabled={!roomId || !nickname}>
          Join room
        </button>

        <label>
          Upload photo
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void onUploadSelected(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="toolbar">
          <div className="tool-row">
            <button className={tool === "brush" ? "active" : ""} onClick={() => setTool("brush")}>
              Brush
            </button>
            <button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>
              Eraser
            </button>
          </div>

          <div className="swatches">
            {COLORS.map((swatch) => (
              <button
                key={swatch}
                style={{ background: swatch }}
                className={color === swatch ? "active" : ""}
                onClick={() => setColor(swatch)}
                aria-label={swatch}
              />
            ))}
          </div>

          <label>
            Size {size}
            <input type="range" min={1} max={40} value={size} onChange={(e) => setSize(Number(e.target.value))} />
          </label>

          <div className="tool-row">
            <button
              onClick={() =>
                roomState &&
                send({
                  type: "undo",
                  roomId: roomState.roomId,
                  clientId
                })
              }
            >
              Undo
            </button>
            <button
              onClick={() =>
                roomState &&
                send({
                  type: "redo",
                  roomId: roomState.roomId,
                  clientId
                })
              }
            >
              Redo
            </button>
          </div>

          <button onClick={exportPng}>Export PNG</button>
        </div>

        <p className="status">Connection: {connectionState}</p>
        <p className="status">Users: {roomState?.users.length ?? 0}</p>
      </aside>

      <main className="canvas-wrap">
        <Stage
          ref={stageRef}
          width={roomState?.imageMeta?.width ?? 1280}
          height={roomState?.imageMeta?.height ?? 720}
          onPointerDown={() => {
            const p = pointerPosition();
            if (p) startStroke(p);
          }}
          onPointerMove={() => {
            if (!draft) return;
            const p = pointerPosition();
            if (p) appendPoint(p);
          }}
          onPointerUp={endStroke}
        >
          <Layer>
            {imageObj && <KonvaImage image={imageObj} x={0} y={0} />}
          </Layer>

          <Layer>
            {visibleStrokes.map((stroke) => (
              <Line
                key={stroke.strokeId}
                points={strokeToLine(stroke)}
                stroke={stroke.tool === "eraser" ? "white" : stroke.style.color}
                strokeWidth={stroke.style.size}
                tension={0.2}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={stroke.tool === "eraser" ? "destination-out" : "source-over"}
              />
            ))}

            {draft && (
              <Line
                points={flattenPoints(draft.points)}
                stroke={draft.tool === "eraser" ? "white" : draft.color}
                strokeWidth={draft.size}
                tension={0.2}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={draft.tool === "eraser" ? "destination-out" : "source-over"}
              />
            )}
          </Layer>
        </Stage>
      </main>
    </div>
  );
}
