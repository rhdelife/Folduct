/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import capabilities from "../../src-tauri/capabilities/default.json";
import cargo from "../../src-tauri/Cargo.toml?raw";
import tauri from "../../src-tauri/tauri.conf.json";
import pkg from "../../package.json";

// 배포 전에 조용히 풀리면 안 되는 설정들입니다.
const csp = tauri.app.security.csp;
const directive = (name: string) => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));

describe("배포 설정", () => {
  it("버전은 package.json 하나를 따르고 Cargo.toml도 같다", () => {
    expect(tauri.version).toBe("../package.json");
    expect(/^version = "(.+)"$/m.exec(cargo)?.[1]).toBe(pkg.version);
  });

  it("CSP는 인라인·eval·외부 접속을 열지 않는다", () => {
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:\/\/(?!ipc\.localhost)|\*/);
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("connect-src")).toBe("connect-src ipc: http://ipc.localhost");
  });

  it("지우기·쓰기 권한이 없다", () => {
    expect(capabilities.permissions.filter((permission) => /remove|write|truncate|copy|create|shell|opener/.test(permission))).toEqual([]);
  });

  it("세 OS의 설치 형식을 모두 만든다", () => {
    expect(tauri.bundle.targets).toEqual(expect.arrayContaining(["app", "dmg", "nsis", "deb", "appimage"]));
    expect(tauri.bundle.icon).toEqual(expect.arrayContaining(["icons/icon.icns", "icons/icon.ico", "icons/128x128.png"]));
  });
});
