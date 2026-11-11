"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { N, LL, Z, KIT } from "./planner";

export const COL = ["#e4572e", "#2e86de", "#27ae60", "#8e44ad"];

const BOUNDS = [[18.88, 72.74], [19.32, 73.05]];

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

function fetchRoute(ids) {
  const coords = [[KIT[1], KIT[0]]].concat(ids.map((o) => [LL[o][1], LL[o][0]])).map((c) => c.join(",")).join(";");
  return fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`)
    .then((r) => r.json())
    .then((j) => {
      const rt = j.routes && j.routes[0];
      if (!rt) throw new Error("no route");
      return { pts: rt.geometry.coordinates.map(([x, y]) => [y, x]), km: rt.distance / 1000, min: rt.duration / 60 };
    })
    .catch(() => ({ fail: true }));
}

function Fit({ pts }) {
  const map = useMap();
  const sig = JSON.stringify(pts);
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(pts, { padding: [28, 28], maxZoom: 14 });
    else map.setView(KIT, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return null;
}

/* trips: [{ ids: [outletIndex, ...] }] in visiting order; trip colour = COL[index % 4] */
export default function RouteMap({ trips }) {
  const mumbai = useMemo(() => trips.map((t, i) => ({ ...t, i })).filter((t) => Z[t.ids[0]] != "P"), [trips]);
  const pune = useMemo(() => trips.map((t, i) => ({ ...t, i })).filter((t) => Z[t.ids[0]] == "P"), [trips]);
  const [routes, setRoutes] = useState({});

  const sig = mumbai.map((t) => t.ids.join("-")).join("|");

  useEffect(() => {
    let dead = false;
    mumbai.forEach((t) => {
      const key = t.ids.join("-");
      if (!cache.has(key)) {
        cache.set(key, fetchRoute(t.ids).then((res) => { if (res.fail) cache.delete(key); return res; }));
      }
      cache.get(key).then((res) => {
        if (!dead) setRoutes((p) => (p[key] === res ? p : { ...p, [key]: res }));
      });
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const used = new Set(mumbai.flatMap((t) => t.ids));
  const fitPts = [KIT].concat(mumbai.flatMap((t) => t.ids.map((o) => LL[o])));

  return (
    <div>
      <div className="h-72 overflow-hidden rounded-lg border border-slate-200 sm:h-96 dark:border-slate-700">
        <MapContainer
          center={KIT}
          zoom={12}
          minZoom={10}
          maxBounds={BOUNDS}
          maxBoundsViscosity={1}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution="© OpenStreetMap contributors © CARTO"
          />
          <Fit pts={fitPts} />

          {/* outlets not in a trip: small grey dots (Mumbai only) */}
          {LL.map((l, o) =>
            Z[o] != "P" && !used.has(o) ? (
              <CircleMarker key={o} center={l} radius={4} pathOptions={{ color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.8, weight: 1 }}>
                <Tooltip>{N[o]}</Tooltip>
              </CircleMarker>
            ) : null
          )}

          {/* one road route per trip, straight dashed line until/unless OSRM answers */}
          {mumbai.map((t) => {
            const r = routes[t.ids.join("-")];
            const c = COL[t.i % 4];
            return r && !r.fail ? (
              <Polyline key={t.ids.join("-")} positions={r.pts} pathOptions={{ color: c, weight: 4, opacity: 0.85 }} />
            ) : (
              <Polyline
                key={t.ids.join("-")}
                positions={[KIT].concat(t.ids.map((o) => LL[o]))}
                pathOptions={{ color: c, weight: 3, opacity: 0.7, dashArray: "6 6" }}
              />
            );
          })}

          {/* numbered pins in visiting order */}
          {mumbai.flatMap((t) =>
            t.ids.map((o, i) => (
              <Marker key={t.i + "-" + o} position={LL[o]} icon={pin(i + 1, COL[t.i % 4])}>
                <Tooltip direction="right" offset={[10, 0]} permanent>{N[o]}</Tooltip>
              </Marker>
            ))
          )}

          <Marker position={KIT} icon={kitchenIcon}>
            <Tooltip direction="left" offset={[-12, 0]}>Kitchen (Tardeo)</Tooltip>
          </Marker>
        </MapContainer>
      </div>

      <div className="mt-2 space-y-1 text-xs">
        {mumbai.map((t) => {
          const r = routes[t.ids.join("-")];
          return (
            <div key={t.i}>
              <b style={{ color: COL[t.i % 4] }}>Trip {t.i + 1}</b>{" "}
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
        {pune.map((t) => (
          <div key={t.i} className="text-slate-500">
            <b style={{ color: COL[t.i % 4] }}>Trip {t.i + 1}</b> is a Pune run ({t.ids.map((o) => N[o]).join(" → ")}), about 150 km away and off the Mumbai map.
          </div>
        ))}
        <div className="text-slate-500">Drive times are typical, not live traffic. Pins show visiting order.</div>
      </div>
    </div>
  );
}
