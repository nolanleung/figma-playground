"use client";

import { parse } from "@/lib/kiwi/parse";
import JSZip from "jszip";
import { useState } from "react";

export default function Home() {
  const [activeCanvas, setActiveCanvas] = useState<string | null>(null);
  const [canvases, setCanvases] = useState<string[]>([]);
  const [schema, setSchema] = useState<any | null>(null);

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
      setSchema(schema.root);
      setCanvases(schema.root.children.map((c: any) => c.name));
      console.log(schema.root);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <main
      className="flex items-center justify-center w-screen h-screen overflow-hidden relative"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {activeCanvas ? (
        <div className="flex flex-col items-center justify-center w-full h-full">
          <button onClick={() => setActiveCanvas(null)}>back</button>
          <div className="flex items-center justify-center w-full h-full flex-wrap">
            {schema.children
              .find((c: any) => c.name === activeCanvas)
              .children.map((c: any) => (
                <div
                  className="flex items-center justify-center w-16 h-16 bg-gray-200 m-2"
                  key={c.id}
                >
                  {c.name}
                </div>
              ))}
          </div>
        </div>
      ) : (
        <ul>
          {canvases.map((canvas) => (
            <li key={canvas} onClick={() => setActiveCanvas(canvas)}>
              {canvas}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

