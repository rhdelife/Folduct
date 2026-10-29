import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  // 공유 API(apps/server). 같은 출처로 보내 CORS 설정 없이 씁니다.
  server: { proxy: { "/api": "http://localhost:4000" } },
  test: {
    environment: "node",
    setupFiles: ["./src/tests/setup.ts"],
  },
});
