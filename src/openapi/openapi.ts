import { RequestMethod, Type } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { z } from 'zod';
import { IS_PUBLIC, OPTIONAL_AUTH, ROLES_KEY } from '../auth/decorators';
import { ROUTE_DOCS } from './route-docs';

/** RouteParamtypes from @nestjs/common (not exported as a public enum). */
const BODY = 3;
const QUERY = 4;
const PARAM = 5;

const PREFIX = '/api';
const METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

type Json = Record<string, unknown>;

interface ArgMeta {
  index: number;
  data?: string;
  pipes?: unknown[];
}

const asSchema = (pipe: unknown): z.ZodType | undefined => {
  const candidate = (pipe as { schema?: unknown } | null)?.schema;
  return candidate !== undefined &&
    typeof (candidate as { safeParse?: unknown }).safeParse === 'function'
    ? (candidate as z.ZodType)
    : undefined;
};
const isObjectIdPipe = (pipe: unknown): boolean =>
  (pipe as { constructor?: { name?: string } } | null)?.constructor?.name === 'ParseObjectIdPipe';

const jsonSchema = (schema: z.ZodType): Json => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Json;
  return rest;
};

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '');
const toTemplate = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

export interface OpenApiDocument extends Json {
  openapi: string;
  paths: Record<string, Record<string, Json>>;
}

/**
 * Builds the OpenAPI 3.1 description from the application that is actually running: controllers, method
 * and path metadata, the global access decorators (@Public, @OptionalAuth, @Roles), explicit status codes,
 * and the Zod schemas carried by the validation pipes. Response *bodies* are described in words only
 * (see route-docs.ts) because their shapes exist only as TypeScript types.
 */
export function buildOpenApi(container: ModulesContainer): OpenApiDocument {
  const reflector = new Reflector();
  const paths: Record<string, Record<string, Json>> = {};

  for (const mod of container.values()) {
    for (const wrapper of mod.controllers.values()) {
      const controller = wrapper.metatype as Type<unknown> | null;
      if (!controller) continue;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string | string[] | undefined;
      const basePath = trimSlashes(Array.isArray(base) ? (base[0] ?? '') : (base ?? ''));
      const proto = controller.prototype as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        const verb = method === undefined ? undefined : METHODS[method];
        if (verb === undefined || method === undefined) continue;

        const own = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const route = trimSlashes(own ?? '');
        const path = toTemplate(`${PREFIX}/${[basePath, route].filter(Boolean).join('/')}`);

        const isPublic =
          reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [handler, controller]) ===
          true;
        const optional =
          reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_AUTH, [handler, controller]) ===
          true;
        const roles =
          reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [handler, controller]) ?? [];
        const explicit = Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined;
        const success = explicit ?? (method === RequestMethod.POST ? 201 : 200);

        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
          string,
          ArgMeta
        >;
        const parameters: Json[] = [];
        let requestBody: Json | undefined;
        let validated = false;
        for (const [key, meta] of Object.entries(args)) {
          const type = Number(key.split(':')[0]);
          const pipes = meta.pipes ?? [];
          if (type === BODY) {
            const schema = pipes.map(asSchema).find((s) => s !== undefined);
            if (schema) {
              validated = true;
              requestBody = {
                required: true,
                content: { 'application/json': { schema: jsonSchema(schema) } },
              };
            }
          } else if (type === QUERY) {
            const schema = pipes.map(asSchema).find((s) => s !== undefined);
            if (schema) {
              validated = true;
              const converted = jsonSchema(schema) as {
                properties?: Record<string, Json>;
                required?: string[];
              };
              for (const [pname, pschema] of Object.entries(converted.properties ?? {})) {
                parameters.push({
                  name: pname,
                  in: 'query',
                  required: converted.required?.includes(pname) ?? false,
                  schema: pschema,
                });
              }
            }
          } else if (type === PARAM && meta.data) {
            const objectId = pipes.some(isObjectIdPipe);
            if (objectId) validated = true;
            parameters.push({
              name: meta.data,
              in: 'path',
              required: true,
              schema: objectId
                ? { type: 'string', pattern: '^[0-9a-fA-F]{24}$' }
                : { type: 'string' },
            });
          }
        }
        parameters.sort((a, b) => `${a.in}${a.name}`.localeCompare(`${b.in}${b.name}`));

        const key = `${verb.toUpperCase()} ${path}`;
        const doc = ROUTE_DOCS[key];
        const access = isPublic
          ? optional
            ? 'public (a valid token changes the result)'
            : 'public'
          : roles.length > 0
            ? roles.join(' or ')
            : 'any signed-in user';
        const writes = method !== RequestMethod.GET;
        const responses: Record<string, Json> = {
          [String(success)]: {
            description: doc?.returns
              ? `Success. \`data\`: ${doc.returns}`
              : 'Success. Wrapped as { success: true, data, timestamp }',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } },
            },
          },
        };
        const error = (description: string): Json => ({
          description,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
          },
        });
        if (validated || writes)
          responses['400'] = error('Validation failed (unknown fields are rejected)');
        if (!isPublic) responses['401'] = error('Missing, invalid, expired or revoked token');
        if (roles.length > 0 || (writes && !isPublic)) {
          responses['403'] = error(
            roles.length > 0
              ? `Not allowed for this role (needs ${roles.join(' or ')})` +
                  (writes ? '; demo viewers can never write' : '')
              : 'Demo viewers can never write',
          );
        }
        if (parameters.some((p) => p.in === 'path'))
          responses['404'] = error('No such record (or not yours)');
        responses['429'] = error('Rate limit reached; see Retry-After');
        responses['503'] = error('Storage unavailable (generic body)');

        const operation: Json = {
          operationId: `${verb}${path.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ?? '').toUpperCase())}`,
          summary: doc?.summary ?? '(undocumented)',
          tags: [path.split('/')[2] ?? 'api'],
          'x-access': access,
          ...(isPublic && !optional ? { security: [] } : {}),
          ...(isPublic && optional ? { security: [{}, { bearerAuth: [] }] } : {}),
          ...(parameters.length > 0 ? { parameters } : {}),
          ...(requestBody ? { requestBody } : {}),
          responses,
        };
        (paths[path] ??= {})[verb] = operation;
      }
    }
  }

  const sortedPaths = Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((p) => {
        const item = paths[p] as Record<string, Json>;
        return [
          p,
          Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((m) => [m, item[m]]),
          ),
        ];
      }),
  );

  return {
    openapi: '3.1.0',
    info: {
      title: 'Atelier Noor API',
      version: '1.0.0-phase1',
      description:
        'Portfolio e-commerce API. **Payments are simulated: no payment gateway exists and no card data is ever accepted.** ' +
        'Every response is wrapped as `{ success, data, timestamp }` (errors: `{ success: false, error, timestamp }`). ' +
        'Requests are rate limited per client address (429 + Retry-After). Generated from the running application.',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    paths: sortedPaths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        SuccessEnvelope: {
          type: 'object',
          required: ['success', 'data', 'timestamp'],
          properties: {
            success: { const: true },
            data: {},
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['success', 'error', 'timestamp'],
          properties: {
            success: { const: false },
            error: {
              type: 'object',
              required: ['statusCode', 'error', 'message'],
              properties: {
                statusCode: { type: 'integer' },
                error: { type: 'string' },
                message: { type: 'string' },
                details: {
                  description:
                    'Validation problems: [{ field, message }]; never echoes input values',
                },
              },
            },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  };
}
