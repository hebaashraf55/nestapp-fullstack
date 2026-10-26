import type { INestApplication } from '@nestjs/common';

export interface RouteInfo {
  method: string;
  path: string;
}

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
}

/** Every route the running Express app has registered, read from the router (not from a hand-kept list). */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const instance = app.getHttpAdapter().getInstance() as { router: { stack: Layer[] } };
  const found = new Map<string, RouteInfo>();
  for (const layer of instance.router.stack) {
    if (!layer.route) continue;
    for (const [method, enabled] of Object.entries(layer.route.methods)) {
      if (!enabled) continue;
      const info = { method: method.toUpperCase(), path: layer.route.path };
      found.set(`${info.method} ${info.path}`, info);
    }
  }
  return [...found.values()].sort((a, b) =>
    `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`),
  );
}
