"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const CK = { name: "Central Kitchen (Tardeo)", position: [18.9769534, 72.8121371] };

const locations = [
  { name: "Gamdevi", position: [18.9592286, 72.8129089] },
  { name: "Worli", position: [18.9945254, 72.8220039] },
  { name: "Marol", position: [19.1122481, 72.8803645] },
  { name: "Juhu", position: [19.0890198, 72.8360391] },
  { name: "Andheri West (DN Nagar)", position: [19.1252344, 72.8318347] },
  { name: "Malad", position: [19.1888664, 72.7782226] },
  { name: "Powai", position: [19.1126571, 72.9112707] },
  { name: "Borivali West", position: [19.2335, 72.853] },
  { name: "Goregaon East", position: [19.128224, 72.8261697] },
  { name: "Kalyani Nagar (Pune)", position: [18.5479783, 73.9180992] },
  { name: "Baner (Pune)", position: [18.5566043, 73.7410824] },
  { name: "Thane West", position: [19.2537495, 72.9821635] },
  { name: "Bandra West", position: [19.052706, 72.827826] },
  { name: "Kandivali East", position: [19.2099865, 72.8731943] },
  { name: "Matunga", position: [19.0269716, 72.8561727] },
];

const allPoints = [CK.position, ...locations.map((loc) => loc.position)];

/* One stable colour per outlet, shared by the route line, the dot and the list row. */
const COLORS = [
  "#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#ea580c", "#0d9488",
  "#6366f1", "#b45309", "#be185d", "#4d7c0f", "#0369a1",
];
const colorFor = (i) => COLORS[i % COLORS.length];

/* OSRM free demo server — typical drive times, not live traffic.
   Cached per outlet so re-renders and dev StrictMode never refetch. */
const cache = new Map();

function fetchRoute(from, to) {
  const coords = [
    [from[1], from[0]],
    [to[1], to[0]],
  ]
    .map((c) => c.join(","))
    .join(";");
  return fetch(
    `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`
  )
    .then((r) => r.json())
    .then((j) => {
      const rt = j.routes && j.routes[0];
      if (!rt) throw new Error("no route");
      return {
        pts: rt.geometry.coordinates.map(([x, y]) => [y, x]),
        km: rt.distance / 1000,
        min: rt.duration / 60,
      };
    })
    .catch(() => ({ fail: true }));
}

const ALL = "__all__";

/** Fit the map to `points` whenever the selection changes. */
function Fit({ points, padding }) {
  const map = useMap();
  useEffect(() => {
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding, maxZoom: 12 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points]);
  return null;
}

export default function MapView() {
  const [selected, setSelected] = useState(ALL);
  const [routes, setRoutes] = useState({});

  /* Fetch every CK -> outlet road route once (4 workers, cached: gentle on the free OSRM demo server). */
  useEffect(() => {
    let dead = false;
    const queue = [...locations];
    const worker = async () => {
      while (queue.length) {
        if (dead) return;
        const loc = queue.shift();
        if (!cache.has(loc.name)) {
          cache.set(
            loc.name,
            fetchRoute(CK.position, loc.position).then((res) => {
              if (res.fail) cache.delete(loc.name);
              return res;
            })
          );
        }
        const res = await cache.get(loc.name);
        if (dead) return;
        setRoutes((prev) => (prev[loc.name] === res ? prev : { ...prev, [loc.name]: res }));
      }
    };
    Promise.allSettled([worker(), worker(), worker(), worker()]);
    return () => {
      dead = true;
    };
  }, []);

  /* Refit the view when the selection changes (fresh array identity = refit). */
  const focusPoints = useMemo(
    () =>
      selected === ALL
        ? [...allPoints]
        : [CK.position, locations.find((l) => l.name === selected).position],
    [selected]
  );
  const focusPadding = selected === ALL ? [140, 40] : [60, 40];

  /* List rows, nearest first once road distances are known. */
  const rows = useMemo(
    () =>
      locations
        .map((loc, i) => ({ loc, i, r: routes[loc.name] }))
        .sort((a, b) => {
          const da = a.r && !a.r.fail ? a.r.km : Infinity;
          const db = b.r && !b.r.fail ? b.r.km : Infinity;
          return da === db ? a.loc.name.localeCompare(b.loc.name) : da - db;
        }),
    [routes]
  );

  const selectedRow = rows.find((row) => row.loc.name === selected);

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[19.08, 72.88]}
        zoom={11}
        maxZoom={18}
        className="h-full w-full"
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri"
          maxNativeZoom={16}
        />

        <Fit points={focusPoints} padding={focusPadding} />

        {/* road routes from the Central Kitchen; dashed straight line until OSRM answers */}
        {locations.map((loc, i) => {
          if (selected !== ALL && selected !== loc.name) return null;
          const r = routes[loc.name];
          const c = colorFor(i);
          const focus = selected === loc.name;
          /* key includes loading state: switching from fallback to road route remounts the
             Polyline — Leaflet's setStyle merges options, so a reused instance would keep
             the fallback's dashArray forever. */
          return r && !r.fail ? (
            <Polyline
              key={loc.name + "-road"}
              positions={r.pts}
              pathOptions={{ color: c, weight: focus ? 5 : 3, opacity: 0.85 }}
            />
          ) : (
            <Polyline
              key={loc.name + "-approx"}
              positions={[CK.position, loc.position]}
              pathOptions={{
                color: c,
                weight: focus ? 4 : 2.5,
                opacity: 0.7,
                dashArray: "6 6",
              }}
            />
          );
        })}

        <CircleMarker
          center={CK.position}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: "#0f172a",
            fillOpacity: 1,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            {CK.name}
          </Tooltip>
        </CircleMarker>

        {locations.map((loc, i) => (
          <CircleMarker
            key={loc.name}
            center={loc.position}
            radius={selected === loc.name ? 7 : 5}
            pathOptions={{
              color: "#ffffff",
              weight: 1.5,
              fillColor: colorFor(i),
              fillOpacity: 0.95,
            }}
          >
            <Tooltip permanent direction="right" offset={[6, 0]}>
              {loc.name}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* dispatch route panel */}
      <div
        className="absolute right-3 top-3 w-72 rounded-lg bg-white/95 p-3 text-sm shadow-lg ring-1 ring-slate-200"
        style={{ zIndex: 1000 }}
      >
        <label className="mb-1 block font-semibold text-slate-700">
          Dispatch route from Central Kitchen
        </label>
        <select
          className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value={ALL}>All routes (overview)</option>
          {rows.map(({ loc }) => (
            <option key={loc.name} value={loc.name}>
              {loc.name}
            </option>
          ))}
        </select>

        {selected === ALL ? (
          <ul className="mt-2 max-h-64 space-y-0.5 overflow-y-auto pr-1">
            {rows.map(({ loc, i, r }) => (
              <li key={loc.name}>
                <button
                  type="button"
                  onClick={() => setSelected(loc.name)}
                  className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-slate-100"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: colorFor(i) }}
                  />
                  <span className="flex-1 truncate">{loc.name}</span>
                  {r && !r.fail ? (
                    <span className="tabular-nums text-slate-500">
                      {r.km.toFixed(1)} km · {Math.round(r.min)} min
                    </span>
                  ) : r ? (
                    <span className="text-amber-600">road n/a</span>
                  ) : (
                    <span className="text-slate-400">…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 text-slate-600">
            {selectedRow.r && !selectedRow.r.fail ? (
              <>
                Road route: <b>{selectedRow.r.km.toFixed(1)} km</b> · about{" "}
                <b>{Math.round(selectedRow.r.min)} min</b> driving
              </>
            ) : selectedRow.r ? (
              <span className="text-amber-600">
                Road route unavailable — showing straight-line distance.
              </span>
            ) : (
              <span className="text-slate-500">Finding road route…</span>
            )}
            <button
              type="button"
              onClick={() => setSelected(ALL)}
              className="mt-1 block text-blue-600 hover:underline"
            >
              &larr; back to all routes
            </button>
          </div>
        )}

        <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
          Typical drive times (OSRM), not live traffic.
        </p>
      </div>
    </div>
  );
}
