"use client";
import { useState } from "react";

export default function Production() {
  const [file, setFile] = useState(null);
  const [date, setDate] = useState("");
  const [items, setItems] = useState([]);
  const [msg, setMsg] = useState("");
  const [over, setOver] = useState(false);

  function pick(f) {
    if (f && f.type.startsWith("image/")) {
      setFile(f);
      setItems([]);
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
      setItems(data.items || []);
      setMsg("Check and edit, then save.");
    } catch (err) {
      setMsg("Failed: " + err.message);
    }
  }

  function edit(i, field, value) {
    const copy = [...items];
    copy[i] = { ...copy[i], [field]: value };
    setItems(copy);
  }

  async function save() {
    try {
      setMsg("Saving...");
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, items }),
      });
      const data = await res.json();
      setMsg(res.ok ? "Saved!" : "Save failed: " + data.error);
    } catch (err) {
      setMsg("Failed: " + err.message);
    }
  }

  return (
    <main className="p-4 max-w-md mx-auto space-y-3">
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

      {items.length > 0 && (
        <>
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border p-2 w-full"
          />
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={it.item_name}
                onChange={(e) => edit(i, "item_name", e.target.value)}
                className="border p-2 flex-1"
              />
              <input
                value={it.qty}
                onChange={(e) => edit(i, "qty", e.target.value)}
                className="border p-2 w-20"
              />
            </div>
          ))}
          <button onClick={save} className="bg-green-600 text-white px-4 py-2 rounded">
            Save
          </button>
        </>
      )}
      <p className="break-words">{msg}</p>
    </main>
  );
}