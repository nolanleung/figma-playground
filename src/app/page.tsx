"use client";

import { parse } from "@/lib/kiwi/parse";
import JSZip from "jszip";

export default function Home() {
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (!(e.target?.result instanceof ArrayBuffer)) {
        return;
      }

      const bytes = e.target.result;
      const arr = new Uint8Array(bytes);
      const zip = new JSZip();
      const files: Record<string, Uint8Array> = {};
      const promises: Promise<void>[] = [];
      await zip.loadAsync(arr).then((zip) => {
        return zip.forEach((path, file) => {
          promises.push(
            file.async("uint8array").then((bytes) => {
              files[path] = bytes;
            })
          );
        });
      });

      await Promise.all(promises);

      const schema = parse(files["canvas.fig"]);
      console.log(schema);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <main
      className="flex items-center justify-center w-screen h-screen overflow-hidden relative"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    ></main>
  );
}
