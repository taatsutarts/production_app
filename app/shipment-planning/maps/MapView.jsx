"use client";

import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

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

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="font-size:30px;">𖡡</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
});

const ckIcon = L.divIcon({
  className: "",
  html: `<div style="background:#111;color:#fff;width:28px;height:28px;border-radius:6px;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 1px 3px rgba(0,0,0,.5)">🏭</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export default function MapView() {
  return (
    <MapContainer
      center={[19.08, 72.88]}
      zoom={11}
      style={{ height: "90vh", width: "100%" }}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri"
        maxZoom={16}
      />

      <Marker position={CK.position} icon={ckIcon}>
        <Tooltip permanent direction="left" offset={[-12, 0]}>
          {CK.name}
        </Tooltip>
      </Marker>

      {locations.map((loc) => (
        <Marker key={loc.name} position={loc.position} icon={pinIcon}>
          <Tooltip permanent direction="right" offset={[10, -15]}>
            {loc.name}
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}