import { decompress } from "fzstd";
import { inflateRaw } from "pako";
import { compileSchema } from "./js";
import { decodeBinarySchema } from "./binary";

export function parse(bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.slice(0, 8));
  if (header !== "fig-kiwi" && header !== "fig-jam.") {
    throw new Error("Invalid header");
  }

  const view = new DataView(bytes.buffer);
  const version = view.getUint32(8, true);
  const chunks = [];
  let offset = 12;

  while (offset < bytes.length) {
    const chunkLength = view.getUint32(offset, true);
    offset += 4;
    chunks.push(bytes.slice(offset, offset + chunkLength));
    offset += chunkLength;
  }

  if (chunks.length < 2) throw new Error("Not enough chunks");
  const uncompressChunk = (bytes: Uint8Array) => {
    try {
      return inflateRaw(bytes);
    } catch (err) {
      try {
        return decompress(bytes);
      } catch {
        throw err;
      }
    }
  };
  const encodedSchema = uncompressChunk(chunks[0]);
  const encodedData = uncompressChunk(chunks[1]);
  const schema = compileSchema(decodeBinarySchema(encodedSchema));
  const { nodeChanges, blobs } = schema.decodeMessage(encodedData);
  const nodes = new Map();

  const orderByPosition = (
    { parentIndex: { position: a } }: { parentIndex: { position: number } },
    { parentIndex: { position: b } }: { parentIndex: { position: number } }
  ) => {
    return Math.sign(b - a);
  };

  for (const node of nodeChanges) {
    const { sessionID, localID } = node.guid;
    nodes.set(`${sessionID}:${localID}`, node);
  }

  for (const node of nodeChanges) {
    if (node.parentIndex) {
      const { sessionID, localID } = node.parentIndex.guid;
      const parent = nodes.get(`${sessionID}:${localID}`);
      if (parent) {
        parent.children ||= [];
        parent.children.push(node);
      }
    }
  }

  for (const node of nodeChanges) {
    if (node.children) {
      node.children.sort(orderByPosition);
    }
  }

  for (const node of nodeChanges) {
    delete node.parentIndex;
  }

  return { version, root: nodes.get("0:0"), blobs };
}
