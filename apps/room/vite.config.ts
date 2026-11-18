import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // 웹에는 /download 소개·내려받기 페이지가 하나 더 있어요. 맥 앱(Tauri)은 index.html만 써요.
  build: { rollupOptions: { input: { main: "index.html", download: "download/index.html" } } },
  test: { environment: "node" },
});
