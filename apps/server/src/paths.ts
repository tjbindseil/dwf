import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDataRoot = path.resolve(here, "../../../data");

export const dataRoot = process.env.DWF_DATA_DIR
  ? path.resolve(process.env.DWF_DATA_DIR)
  : defaultDataRoot;

export const imagesDir = path.join(dataRoot, "images");
export const roomsDir = path.join(dataRoot, "rooms");
