import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  INestApplication,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { createTestApp } from './helpers/create-test-app';

@Controller('boom')
class BoomController {
  @Get('unexpected')
  unexpected(): never {
    throw new Error('database password pa55word must never reach a client');
  }

  @Get('known')
  known(): never {
    throw new NotFoundException('Thing not found');
  }

  @Get('validation')
  validation(): never {
    throw new BadRequestException(['email must be an email', 'name should not be empty']);
  }

  @Get('dev-500')
  dev500(): never {
    throw new InternalServerErrorException('connection string mongodb-host-internal leaked');
  }

  @Get('dev-503')
  dev503(): never {
    throw new ServiceUnavailableException({
      message: 'redis at 10.0.0.5 is down',
      details: { host: '10.0.0.5', stack: 'at secret.ts:1' },
    });
  }

  @Get('dev-502')
  dev502(): never {
    throw new HttpException(
      { message: ['upstream token abc123 rejected'], details: 'abc123' },
      502,
    );
  }

  @Get('item/:id')
  item(@Param('id') id: string): { id: string } {
    return { id };
  }
}

describe('HTTP application setup', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /api/health', () => {
    it('returns 200 inside the success envelope', async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body).toEqual({
        success: true,
        data: { status: 'ok', paymentsMode: 'simulated' },
        timestamp: expect.any(String),
      });
      expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    });

    it('is not served without the /api prefix', async () => {
      app = await createTestApp();
      await request(app.getHttpServer()).get('/health').expect(404);
    });
  });

  describe('error envelope', () => {
    beforeEach(async () => {
      app = await createTestApp({}, [BoomController]);
    });

    it('unknown route -> 404 failure envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/does-not-exist').expect(404);
      expect(res.body).toMatchObject({
        success: false,
        error: { statusCode: 404, error: 'Not Found' },
      });
      expect(res.body.timestamp).toEqual(expect.any(String));
    });

    it('known HttpException keeps its status and message', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/known').expect(404);
      expect(res.body.error).toMatchObject({ statusCode: 404, message: 'Thing not found' });
    });

    it('unexpected error -> generic 500 that leaks nothing', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/unexpected').expect(500);
      expect(res.body).toMatchObject({
        success: false,
        error: { statusCode: 500, message: 'Internal server error' },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/pa55word|password|stack|\bat /);
    });

    it('developer-thrown 500 HttpException does not expose its message', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/dev-500').expect(500);
      expect(res.body.error).toMatchObject({ statusCode: 500, message: 'Internal server error' });
      expect(res.body.error.details).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/mongodb|leaked/);
    });

    it('developer-thrown 503 drops message and details', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/dev-503').expect(503);
      expect(res.body.error).toMatchObject({ statusCode: 503, message: 'Service Unavailable' });
      expect(res.body.error.details).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/redis|10\.0\.0\.5|secret/);
    });

    it('developer-thrown 502 with array message drops details', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/dev-502').expect(502);
      expect(res.body.error).toMatchObject({ statusCode: 502, message: 'Bad Gateway' });
      expect(JSON.stringify(res.body)).not.toMatch(/abc123|token/);
    });

    it('safe 4xx validation errors keep their details', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/validation').expect(400);
      expect(res.body.error.details).toEqual([
        'email must be an email',
        'name should not be empty',
      ]);
    });

    it('bad percent-encoding in a matched route param -> 400 that does not echo the input', async () => {
      const res = await request(app.getHttpServer()).get('/api/boom/item/%FF').expect(400);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/%FF|decode param/i);
    });

    it('malformed JSON body -> 400 without echoing the payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send('{"bad": SECRET_PAYLOAD')
        .expect(400);
      expect(res.body.error).toMatchObject({ statusCode: 400, message: 'Malformed JSON body' });
      expect(JSON.stringify(res.body)).not.toContain('SECRET_PAYLOAD');
    });

    it('undecodable percent-encoding on an unmatched path -> clean 404 envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/%FF').expect(404);
      expect(res.body).toMatchObject({ success: false, error: { statusCode: 404 } });
    });

    it('valid JSON on a route that does not accept POST -> 404, not a parser error', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send({ ok: true })
        .expect(404);
      expect(res.body.success).toBe(false);
    });

    it('oversized body -> 413 failure envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/health')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ blob: 'x'.repeat(200 * 1024) }))
        .expect(413);
      expect(res.body.error).toMatchObject({ statusCode: 413 });
    });
  });

  describe('security headers (helmet)', () => {
    it('sets hardening headers and hides the framework', async () => {
      app = await createTestApp();
      const res = await request(app.getHttpServer()).get('/api/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS allow-list', () => {
    const allowed = 'https://shop.example.com';

    it('echoes an allowed origin', async () => {
      app = await createTestApp({ CORS_ORIGINS: allowed });
      const res = await request(app.getHttpServer()).get('/api/health').set('Origin', allowed);
      expect(res.headers['access-control-allow-origin']).toBe(allowed);
    });

    it('does not grant a different origin', async () => {
      app = await createTestApp({ CORS_ORIGINS: allowed });
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'https://evil.example.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not treat a look-alike origin as allowed', async () => {
      app = await createTestApp({ CORS_ORIGINS: allowed });
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'https://shop.example.com.evil.com');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers a preflight from an allowed origin', async () => {
      app = await createTestApp({ CORS_ORIGINS: allowed });
      const res = await request(app.getHttpServer())
        .options('/api/health')
        .set('Origin', allowed)
        .set('Access-Control-Request-Method', 'GET');
      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(allowed);
    });

    it('sends no CORS headers at all when the allow-list is empty', async () => {
      app = await createTestApp({ CORS_ORIGINS: '' });
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('AppModule.register (the module main.ts boots)', () => {
    it('wires the health endpoint with the injected environment', async () => {
      const env = loadEnv({ NODE_ENV: 'test' });
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule.register(env)],
      }).compile();
      app = moduleRef.createNestApplication();
      configureApp(app, env);
      await app.init();
      const res = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(res.body.data).toEqual({ status: 'ok', paymentsMode: 'simulated' });
    });
  });
});
