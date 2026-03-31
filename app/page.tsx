"use client";

import { useState } from "react";

export default function Home() {
  const [randomNum, setRandomNum] = useState<number | null>(null);

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
    </main>
  );
}
