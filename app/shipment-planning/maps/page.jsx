"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
});

export default function MapsPage() {
  return (
    <div className="w-full h-[calc(100vh-64px)] min-h-[600px]">
      <MapView />
    </div>
  );
}