import type { ReactNode } from "react";

// 크기·날짜·형식 같은 짧은 정보 여러 개를 한 줄에 둘 때. 가운뎃점(·)으로 잇지 않고 칸 사이를 띄워 나눠요(Hallmark 바닥 규칙 10).
// false·null·빈 문자열은 빼요. 화면 읽기 프로그램에는 쉼표로 이어 읽혀요.
export function Meta({ items, className }: { items: (ReactNode | false | null | undefined)[]; className?: string }) {
  const shown = items.filter((item) => item !== false && item !== null && item !== undefined && item !== "");
  return (
    <span className={className ? `meta ${className}` : "meta"}>
      {shown.map((item, at) => (
        <span key={at}>
          {item}
          {at < shown.length - 1 && <span className="sr-only">, </span>}
        </span>
      ))}
    </span>
  );
}
