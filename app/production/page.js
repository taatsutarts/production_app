"use client";
import { useState } from "react";

export default function Production() {
  const [file, setFile] = useState(null);
  const [date, setDate] = useState("");
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [over, setOver] = useState(false);

  function pick(f) {
    if (f && f.type.startsWith("image/")) {
      setFile(f);
      setRows([]);
      setDate("");
      setMsg("");
    } else {
      setMsg("Please choose an image.");
    }
  }

  function drop(e) {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  }

  async function upload() {
    try {
      setMsg("Reading...");
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) {
        setMsg("Error " + res.status + ": " + text.slice(0, 200));
        return;
      }
      const data = JSON.parse(text);
      setDate(data.date || "");
      setRows(data.rows || []);
      const nOpen = (data.rows || []).filter((r) => r.opening !== "").length;
      const nProd = (data.rows || []).filter((r) => r.production !== "").length;
      setMsg(
        (data.openingFailed ? "Opening failed (Gemini busy), upload again. " : "") +
          "Production: " + nProd + ", Opening: " + nOpen +
          ". Check, edit, then save."
      );
    } catch (err) {
      setMsg("Failed: " + err.message);
    }
  }

  function edit(i, field, value) {
    const copy = [...rows];
    copy[i] = { ...copy[i], [field]: value };
    setRows(copy);
  }

  async function save() {
    try {
      setMsg("Saving...");
      const has = (v) => v !== "" && v != null;
      const items = rows
        .filter((r) => has(r.production))
        .map((r) => ({ item_name: r.item_name, qty: r.production }));
      const opening = rows
        .filter((r) => has(r.opening))
        .map((r) => ({ item_name: r.item_name, qty: r.opening }));

      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, items, opening }),
      });
      const data = await res.json();
      setMsg(res.ok ? "Saved!" : "Save failed: " + data.error);
    } catch (err) {
      setMsg("Failed: " + err.message);
    }
  }

  return (
    <main className="p-3 max-w-2xl mx-auto space-y-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={
          "block border-2 border-dashed rounded p-8 text-center cursor-pointer " +
          (over ? "bg-blue-100 border-blue-500" : "border-gray-400")
        }
      >
        {file ? file.name : "Drag & drop a photo here, or tap to choose"}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files[0])}
        />
      </label>

      {file && (
        <img src={URL.createObjectURL(file)} alt="preview" className="w-full rounded" />
      )}

      <button
        onClick={upload}
        disabled={!file}
        className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
      >
        Upload
      </button>

      {rows.length > 0 && (
        <>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border p-2 w-full"
          />

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-1 text-left">Item</th>
                <th className="border p-1 w-16">Opening</th>
                <th className="border p-1 w-16">Prod.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.item_name.startsWith("???") ? "bg-red-100" : ""}>
                  <td className="border p-0">
                    <textarea
                      rows={2}
                      value={r.item_name}
                      onChange={(e) => edit(i, "item_name", e.target.value)}
                      className="w-full p-1 text-xs resize-none bg-transparent"
                    />
                  </td>
                  <td className="border p-0">
                    <input
                      value={r.opening}
                      inputMode="decimal"
                      onChange={(e) => edit(i, "opening", e.target.value)}
                      className="w-full p-1 text-center bg-transparent"
                    />
                  </td>
                  <td className="border p-0">
                    <input
                      value={r.production}
                      inputMode="decimal"
                      onChange={(e) => edit(i, "production", e.target.value)}
                      className="w-full p-1 text-center bg-transparent"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={save} className="bg-green-600 text-white px-4 py-2 rounded">
            Save
          </button>
        </>
      )}
      <p className="break-words">{msg}</p>
    </main>
  );
}