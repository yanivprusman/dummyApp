export default function Home() {
  return (
    <main style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
      <button style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: "#0070f3", color: "white", cursor: "pointer" }}>
        Click me
      </button>
      <button style={{ padding: "12px 24px", fontSize: "16px", borderRadius: "8px", border: "none", backgroundColor: "#0070f3", color: "white", cursor: "pointer", marginLeft: "12px" }}>
        Submit
      </button>
    </main>
  );
}
