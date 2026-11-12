"use client";

import dynamic from "next/dynamic";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
});

export default function MapsPage() {
  return (
    <div className="h-[calc(100vh-7.5rem)] min-h-[560px] md:h-[calc(100vh-5rem)]">
      <MapView />
    </div>
  );
}