import { useEffect, useState } from "react";

export type AppRoute =
  | { name: "desk" }
  | { name: "project"; projectId: string }
  | { name: "login" }
  | { name: "shared" }
  | { name: "sharedProject"; projectId: string }
  | { name: "acceptShare"; token: string }
  | { name: "missing"; path: string };

export function parseRoute(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "/desk") return { name: "desk" };
  const project = pathname.match(/^\/projects\/([^/]+)$/);
  if (project) return { name: "project", projectId: decodeURIComponent(project[1]) };
  if (pathname === "/login") return { name: "login" };
  if (pathname === "/shared") return { name: "shared" };
  const shared = pathname.match(/^\/shared\/([^/]+)$/);
  if (shared) return { name: "sharedProject", projectId: decodeURIComponent(shared[1]) };
  const share = pathname.match(/^\/share\/([^/]+)$/);
  if (share) return { name: "acceptShare", token: decodeURIComponent(share[1]) };
  return { name: "missing", path: pathname };
}

export function navigate(path: string) {
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    if (window.location.pathname === "/") window.history.replaceState(null, "", "/desk");
    const sync = () => setRoute(parseRoute(window.location.pathname));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return route;
}
