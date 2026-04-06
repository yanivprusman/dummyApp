"use client";

import { useState, useRef } from "react";

interface ButtonPosition {
  x: number;
  y: number;
}

export default function Home() {
  const [randomNum, setRandomNum] = useState<number | null>(null);
  const [randomColor, setRandomColor] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, ButtonPosition>>({});
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const didDragRef = useRef(false);

  const colors = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Pink", "Cyan", "Magenta", "Lime"];
  const colorMap: Record<string, string> = { Red: "#ef4444", Blue: "#3b82f6", Green: "#22c55e", Yellow: "#eab308", Purple: "#a855f7", Orange: "#f97316", Pink: "#ec4899", Cyan: "#06b6d4", Magenta: "#d946ef", Lime: "#84cc16" };

  const handleMouseDown = (id: string, e: React.MouseEvent) => {
    const pos = positions[id] || { x: 0, y: 0 };
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    didDragRef.current = false;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const { id, startX, startY, origX, origY } = dragRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDragRef.current = true;
      setPositions(prev => ({
        ...prev,
        [id]: { x: origX + dx, y: origY + dy },
      }));
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const btnStyle = (id: string, bg: string): React.CSSProperties => ({
    padding: "12px 24px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "none",
    backgroundColor: bg,
    color: "white",
    cursor: "grab",
    position: "relative",
    transform: `translate(${(positions[id]?.x ?? 0)}px, ${(positions[id]?.y ?? 0)}px)`,
    userSelect: "none",
  });

  return (
    <main style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", gap: "12px" }}>
      <button
        data-id="click-me"
        onMouseDown={(e) => handleMouseDown("click-me", e)}
        style={btnStyle("click-me", "#0070f3")}
      >
        Click me
      </button>
      <button
        data-id="submit"
        onMouseDown={(e) => handleMouseDown("submit", e)}
        style={btnStyle("submit", "#0070f3")}
      >
        Submit
      </button>
      <button
        data-id="random-number"
        onMouseDown={(e) => handleMouseDown("random-number", e)}
        onClick={() => { if (!didDragRef.current) setRandomNum(Math.floor(Math.random() * 100) + 1); }}
        style={btnStyle("random-number", "#e91e63")}
      >
        {randomNum !== null ? `Random: ${randomNum}` : "Random"}
      </button>
      <button
        data-id="random-color"
        onMouseDown={(e) => handleMouseDown("random-color", e)}
        onClick={() => { if (!didDragRef.current) setRandomColor(colors[Math.floor(Math.random() * colors.length)]); }}
        style={btnStyle("random-color", randomColor ? colorMap[randomColor] : "#22c55e")}
      >
        {randomColor ? `Color: ${randomColor}` : "Random Color"}
      </button>
      <button
        data-id="placeholder"
        onMouseDown={(e) => handleMouseDown("placeholder", e)}
        style={btnStyle("placeholder", "#a855f7")}
      >
        Button 5
      </button>
      <button
        data-id="placeholder-6"
        onMouseDown={(e) => handleMouseDown("placeholder-6", e)}
        style={btnStyle("placeholder-6", "#f97316")}
      >
        Button 6
      </button>
    </main>
  );
}
