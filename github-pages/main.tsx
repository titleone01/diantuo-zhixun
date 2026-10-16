import "../app/simulator/browser-runtime";
import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

declare global {
  interface Window { diantuoStartup?: { supported: boolean; complete: () => void; failed: () => void } }
}
function Ready() { useEffect(() => { window.diantuoStartup?.complete(); }, []); return null; }

if (window.diantuoStartup?.supported !== false) createRoot(document.getElementById("root")!, {
  onUncaughtError: () => window.diantuoStartup?.failed(),
}).render(
  <React.StrictMode>
    <Home />
    <Ready />
  </React.StrictMode>,
);
