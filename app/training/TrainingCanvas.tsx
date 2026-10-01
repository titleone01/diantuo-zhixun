"use client";

import { useEffect, useRef, useState } from "react";
import projectCatalog from "../../shared/training-projects.json";
import { WiringScene } from "./scene/WiringScene";
import { DrawingPreview, ProjectPanel } from "./ProjectPanel";
import { useWiringSceneStore } from "./scene/store";
import { workspaceRequest, type Session, type TrainingProject } from "./workspace-api";

export function TrainingCanvas() {
  const [session, setSession] = useState<Session | null>(null);
  const [projects, setProjects] = useState<TrainingProject[]>(projectCatalog.map((item) => ({ ...item, drawing: null })));
  const [selectedId, setSelectedId] = useState("project-02");
  const [preview, setPreview] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const projectRequest = useRef(0);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (response.status >= 500) throw new Error("账号服务暂时不可用，请刷新重试");
        // The development server and static build have no account API.
        if (!response.headers.get("content-type")?.includes("application/json")) {
          if (active) setReady(true);
          return;
        }
        if (!response.ok) throw new Error("账号服务暂时不可用，请刷新重试");
        const current = await response.json() as Session;
        const data = await workspaceRequest<{ projects: TrainingProject[] }>("/api/projects");
        if (active) { setSession(current); setProjects(data.projects); setReady(true); }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "工作台加载失败");
      }
    })();
    return () => { active = false; };
  }, []);
  const refreshProjects = async () => {
    const request = ++projectRequest.current;
    const data = await workspaceRequest<{ projects: TrainingProject[] }>("/api/projects");
    if (request === projectRequest.current) setProjects(data.projects);
  };
  const selected = projects.find((item) => item.id === selectedId)!;
  if (!ready) return <div className="workspace-loading" role="status">{error || "正在加载训练工作台…"}{error && <button onClick={() => window.location.reload()}>重新加载</button>}</div>;
  return <>
    <WiringScene
      storageKey={session ? `diantuo-wiring-${session.user.id}-dol-v2` : "diantuo-wiring-scene-v2"}
      simulationEnabled={selected.simulation === "dol"}
      selectedProjectName={selected.name}
      projectPanel={<ProjectPanel session={session} projects={projects} selectedId={selectedId} onSelect={(id) => {
        useWiringSceneStore.getState().switchPowerOff();
        setSelectedId(id); setPreview(false);
        if (session) void refreshProjects().catch((failure) => setError(String(failure)));
      }} onRefresh={refreshProjects} onPreview={() => setPreview(true)} />}
    />
    {preview && selected.drawing && <DrawingPreview project={selected} onClose={() => setPreview(false)} />}
    {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
  </>;
}
