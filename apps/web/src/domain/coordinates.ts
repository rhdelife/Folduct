import type { Card, Viewport, Zone } from "./models";

export type Point = {
  x: number;
  y: number;
};

export function absoluteOrigin(card: Pick<Card, "x" | "y" | "zoneId">, zones: Pick<Zone, "id" | "x" | "y">[]): Point | null {
  if (card.zoneId === null) return { x: card.x, y: card.y };
  const zone = zones.find((item) => item.id === card.zoneId);
  if (!zone) return null;
  return { x: zone.x + card.x, y: zone.y + card.y };
}

export function toZoneRelative(absolute: Point, zone: Pick<Zone, "x" | "y">): Point {
  return { x: absolute.x - zone.x, y: absolute.y - zone.y };
}

export function translateZone<T extends Zone>(zone: T, dx: number, dy: number): T {
  return { ...zone, x: zone.x + dx, y: zone.y + dy };
}

export function releaseZone(cards: Card[], zones: Zone[], zoneId: string): { cards: Card[]; zones: Zone[] } {
  const zone = zones.find((item) => item.id === zoneId);
  if (!zone) return { cards: cards.map((card) => ({ ...card })), zones: zones.map((item) => ({ ...item })) };
  return {
    zones: zones.filter((item) => item.id !== zoneId).map((item) => ({ ...item })),
    cards: cards.map((card) => {
      if (card.zoneId !== zoneId) return { ...card };
      return { ...card, zoneId: null, x: zone.x + card.x, y: zone.y + card.y };
    }),
  };
}

export function screenToLogical(screen: Point, viewport: Viewport): Point {
  return {
    x: viewport.x + screen.x / viewport.scale,
    y: viewport.y + screen.y / viewport.scale,
  };
}

export function logicalToScreen(logical: Point, viewport: Viewport): Point {
  return {
    x: (logical.x - viewport.x) * viewport.scale,
    y: (logical.y - viewport.y) * viewport.scale,
  };
}
