# DWF Live Draw MVP

Realtime collaborative photo drawing app.

## Stack
- Web: React + Vite + Konva (`apps/web`)
- API/Realtime: Fastify + ws (`apps/server`)
- Shared protocol/types: `packages/protocol`

## Quickstart
1. Install dependencies:
   - `npm install`
2. Start server:
   - `npm run dev -w @dwf/server`
3. Start web app:
   - `npm run dev -w @dwf/web`
4. Open `http://localhost:5173`

Default API URL is `http://localhost:3001`. Override with `VITE_API_URL`.
Server data directory defaults to `<repo>/data`. Override with `DWF_DATA_DIR`.

## API
- `POST /rooms`
- `POST /rooms/:roomId/image` (PNG/JPEG/WEBP, max 10MB, max 4096px)
- `GET /rooms/:roomId/bootstrap`
- WS endpoint: `/ws`

## Tests
- Server: `npm run test -w @dwf/server`
- Web: `npm run test -w @dwf/web`

## Leadership Artifacts
- Weekly checklist: `docs/release-checklist.md`
- Decision log templates: `docs/decisions/`
- Mini specs: `docs/specs/`
