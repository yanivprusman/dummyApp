"use client";

import { useState } from "react";

export default function Home() {
  const [randomNum, setRandomNum] = useState<number | null>(null);
  const [randomColor, setRandomColor] = useState<string | null>(null);

  const colors = ["Red", "Blue", "Green", "Yellow", "Purple", "Orange", "Pink", "Cyan", "Magenta", "Lime"];
  const colorMap: Record<string, string> = { Red: "#ef4444", Blue: "#3b82f6", Green: "#22c55e", Yellow: "#eab308", Purple: "#a855f7", Orange: "#f97316", Pink: "#ec4899", Cyan: "#06b6d4", Magenta: "#d946ef", Lime: "#84cc16" };

  return (
    <main style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", gap: "12px" }}>
      <button data-id="click-me" style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: "#0070f3", color: "white", cursor: "pointer" }}>
        Click me
      </button>
      <button data-id="submit" style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: "#0070f3", color: "white", cursor: "pointer" }}>
        Submit
      </button>
      <button
        data-id="random-number"
        onClick={() => setRandomNum(Math.floor(Math.random() * 100) + 1)}
        style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: "#e91e63", color: "white", cursor: "pointer" }}
      >
        {randomNum !== null ? `Random: ${randomNum}` : "Random"}
      </button>
      <button
        data-id="random-color"
        onClick={() => setRandomColor(colors[Math.floor(Math.random() * colors.length)])}
        style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: randomColor ? colorMap[randomColor] : "#ef4444", color: "white", cursor: "pointer" }}
      >
        {randomColor ? `Color: ${randomColor}` : "Random Color"}
      </button>
    </main>
  );
}
