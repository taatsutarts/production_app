"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { N, Z } from "./planner";

export const COL = ["#e4572e", "#2e86de", "#27ae60", "#8e44ad"];

const BOUNDS = [[18.88, 72.74], [19.32, 73.05]]; // Mumbai outlets
const PUNE_BOUNDS = [[18.4, 72.65], [19.4, 74.1]]; // widens when a Pune run is in the plan

// Esri light-grey tiles (same as your working map). To use Carto instead:
// url "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution "© OpenStreetMap contributors © CARTO"
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTR = "Tiles &copy; Esri";

const pin = (n, color) =>
  L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;width:22px;height:22px;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font:700 11px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.45)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

const kitchenIcon = L.divIcon({
  className: "",
  html: `<div style="background:#111;color:#fff;width:26px;height:26px;border-radius:6px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 1px 3px rgba(0,0,0,.45)">🏭</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

/* OSRM (free demo server). Typical drive times, not live traffic.
   Cached per trip so re-renders and dev StrictMode never refetch. */
const cache = new Map();

function fetchRoute(ids, ll, kit) {
  const coords = [[kit[1], kit[0]]].concat(ids.map((o) => [ll[o][1], ll[o][0]])).map((c) => c.join(",")).join(";");
  return fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)
    .then((r) => r.json())
    .then((j) => {
      const rt = j.routes && j.routes[0];
      if (!rt) throw new Error("no route");
      return { pts: rt.geometry.coordinates.map(([x, y]) => [y, x]), km: rt.distance / 1000, min: rt.duration / 60 };
    })
    .catch(() => ({ fail: true }));
}

function Fit({ pts, kit }) {
  const map = useMap();
  const sig = JSON.stringify(pts);
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(pts, { padding: [28, 28], maxZoom: 14 });
    else map.setView(kit, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

// panning limits: tight around Mumbai normally, wide enough for Pune runs when needed
function Bounds({ pune }) {
  const map = useMap();
  useEffect(() => {
    map.setMaxBounds(pune ? PUNE_BOUNDS : BOUNDS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pune]);
  return null;
}

/* trips: [{ ids: [outletIndex, ...] }] in visiting order; trip colour = COL[index % 4]
   ll/kit: coordinates per outlet index + kitchen, from the outlets table (required —
   the page only renders the map once the table config is complete). The route cache
   key includes the coordinates, so updating them in the database refetches the routes. */
export default function RouteMap({ trips, ll, kit }) {
  const all = useMemo(() => trips.map((t, i) => ({ ...t, i })), [trips]);
  const pune = all.filter((t) => Z[t.ids[0]] == "P");
  const [routes, setRoutes] = useState({});

  // cache/refetch signature: the stops AND their coordinates
  const tkey = (t) => [kit].concat(t.ids.map((o) => ll[o])).map((c) => c[0].toFixed(5) + "," + c[1].toFixed(5)).join(";");
  const sig = all.map((t) => tkey(t)).join("|");

  useEffect(() => {
    let dead = false;
    all.forEach((t) => {
      const key = tkey(t);
      if (!cache.has(key)) {
        cache.set(key, fetchRoute(t.ids, ll, kit).then((res) => { if (res.fail) cache.delete(key); return res; }));
      }
      cache.get(key).then((res) => {
        if (!dead) setRoutes((p) => (p[key] === res ? p : { ...p, [key]: res }));
      });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const used = new Set(all.flatMap((t) => t.ids));
  const fitPts = [kit].concat(all.flatMap((t) => t.ids.map((o) => ll[o])));

  return (
    <div>
      <div className="h-72 overflow-hidden rounded-xl sm:h-96">
        <MapContainer
          center={kit}
          zoom={12}
          minZoom={7}
          maxBounds={BOUNDS}
          maxBoundsViscosity={1}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={16} />
          <Bounds pune={pune.length > 0} />
          <Fit pts={fitPts} kit={kit} />

          {/* outlets not in a trip: small grey dots */}
          {ll.map((l, o) =>
            !used.has(o) ? (
              <CircleMarker key={o} center={l} radius={4} pathOptions={{ color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.8, weight: 1 }}>
                <Tooltip>{N[o]}</Tooltip>
              </CircleMarker>
            ) : null
          )}

          {/* one road route per trip, straight dashed line until/unless OSRM answers.
              Different keys force a remount when the road route arrives — Leaflet's
              setStyle never removes the fallback's dashArray otherwise. */}
          {all.map((t) => {
            const r = routes[tkey(t)];
            const c = COL[t.i % 4];
            return r && !r.fail ? (
              <Polyline key={t.ids.join("-") + "-road"} positions={r.pts} pathOptions={{ color: c, weight: 4, opacity: 0.85 }} />
            ) : (
              <Polyline
                key={t.ids.join("-") + "-approx"}
                positions={[kit].concat(t.ids.map((o) => ll[o]))}
                pathOptions={{ color: c, weight: 3, opacity: 0.7, dashArray: "6 6" }}
              />
            );
          })}

          {/* numbered pins in visiting order */}
          {all.flatMap((t) =>
            t.ids.map((o, i) => (
              <Marker key={t.i + "-" + o} position={ll[o]} icon={pin(i + 1, COL[t.i % 4])}>
                <Tooltip direction="right" offset={[10, 0]} permanent>{N[o]}</Tooltip>
              </Marker>
            ))
          )}

          <Marker position={kit} icon={kitchenIcon}>
            <Tooltip direction="left" offset={[-12, 0]}>Kitchen (Tardeo)</Tooltip>
          </Marker>
        </MapContainer>
      </div>

      <div className="mt-2 space-y-1 text-sm">
        {all.map((t) => {
          const r = routes[tkey(t)];
          return (
            <div key={t.i}>
              <b style={{ color: COL[t.i % 4] }}>Trip {t.i + 1}</b>
              {Z[t.ids[0]] == "P" && <span className="text-slate-400"> (Pune)</span>}{" "}
              {r && !r.fail ? (
                <span>{r.km.toFixed(1)} km · about {Math.round(r.min)} min driving</span>
              ) : r && r.fail ? (
                <span className="text-amber-600">road route unavailable, showing straight lines</span>
              ) : (
                <span className="text-slate-500">finding road route…</span>
              )}
            </div>
          );
        })}
        <div className="text-slate-400">Typical drive times, not live traffic.</div>
      </div>
    </div>
  );
}
