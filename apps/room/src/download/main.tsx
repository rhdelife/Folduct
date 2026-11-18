import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import { DownloadPage } from "./DownloadPage";

// /download 소개·내려받기 페이지(웹 전용, 2026-11-18 요청). 맥 앱(Tauri)은 이 입구를 쓰지 않아요.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DownloadPage />
  </StrictMode>,
);
