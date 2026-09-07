import legacy from './index.js';
import { runProfessorDigest, DIGEST_VERSION } from './professor-digest.js';
import { buildV2Health } from './v2/health.js';
import { buildDeepHealth } from './v2/deep-health.js';
import { enrichStudentDashboard } from './v2/student-home.js';
import { AUTH_BINDINGS, strictBinding } from './authorization.js';

export const AI_STATUS = Object.freeze({ enabled: false, status: 'paused', configurationRetained: true });
let deepHealthCache = { value: null, expiresAt: 0 };

export function shouldRestartOAuth(status, body) {
  return status === 401 && body?.message === '登录状态已过期';
}

function aiPaused(request, env) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
  try { headers.set('Access-Control-Allow-Origin', new URL(env.FRONTEND_URL).origin); } catch (_) {}
  return new Response(JSON.stringify({ code: 'AI_PAUSED', message: 'AI 功能暂未启用，相关设计与配置保留。', ai: AI_STATUS }), { status: 503, headers });
}

function jsonNoStore(value, env, status = 200) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin'
  });
  try { headers.set('Access-Control-Allow-Origin', new URL(env.FRONTEND_URL).origin); } catch (_) {}
  return new Response(JSON.stringify(value), { status, headers });
}

async function cachedDeepHealth(env) {
  const key = JSON.stringify([env.FEISHU_APP_ID, env.MEMBERS_TABLE_ID, env.MEMBERS_BASE_APP_TOKEN, env.MEMBERS_BASE_WIKI_TOKEN, env.WEEKLY_TABLE_ID, env.WEEKLY_BASE_APP_TOKEN, env.WEEKLY_BASE_WIKI_TOKEN, env.FEISHU_BASE_APP_TOKEN, env.FEISHU_BASE_WIKI_TOKEN]);
  if (deepHealthCache.key === key && deepHealthCache.value && deepHealthCache.expiresAt > Date.now()) return deepHealthCache.value;
  const value = await buildDeepHealth(env);
  deepHealthCache = { key, value, expiresAt: Date.now() + 60_000 };
  return value;
}

function cloneJsonResponse(response, value) {
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(value), { status: response.status, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method !== 'OPTIONS' && /^\/api\/ai(?:\/|$)/.test(path)) return aiPaused(request, env);

    if (request.method === 'GET' && path === '/api/v2/health') {
      return jsonNoStore(buildV2Health(env), env);
    }
    if (request.method === 'GET' && path === '/api/v2/health/deep') {
      return jsonNoStore(await cachedDeepHealth(env), env);
    }

    const response = await legacy.fetch(request, env, ctx);

    if (path === '/auth/callback' && response.status === 401) {
      const body = await response.clone().json().catch(() => null);
      if (shouldRestartOAuth(response.status, body)) {
        const launch = new URL('/auth/launch', url.origin);
        if (env.FRONTEND_URL) launch.searchParams.set('returnTo', env.FRONTEND_URL);
        return Response.redirect(launch.toString(), 302);
      }
    }

    if (request.method === 'GET' && path === '/api/dashboard' && response.ok) {
      const dashboard = await response.json();
      return cloneJsonResponse(response, enrichStudentDashboard(dashboard));
    }

    if (path !== '/health' || !response.ok) return response;
    const body = await response.json();
    const deep = await cachedDeepHealth(env);
    const members = deep.tables?.members || {};
    const weekly = deep.tables?.weekly || {};
    const discovery = deep.discovery || {};
    const headers = new Headers(response.headers);
    return new Response(JSON.stringify({
      ...body,
      securityPatch: 'p0-20260907-2',
      configured: body.configured && deep.ok === true && AUTH_BINDINGS.every(key => { try { strictBinding(env, key); return true; } catch (_) { return false; } }),
      authorization: { enforced: true, mode: 'authoritative-fail-closed', nativeFeishuAclManaged: false,
        bindings: Object.fromEntries(AUTH_BINDINGS.map(key => { try { strictBinding(env, key); return [key, true]; } catch (_) { return [key, false]; } })) },
      deepBaseReadOk: deep.ok === true,
      deepLocatorOk: deep.locator?.ok === true,
      deepAppMetadataOk: deep.appMetadata?.ok === true,
      baseHasAnyTables: discovery.hasAnyTables === true,
      baseHasMemberLikeTable: discovery.hasMemberLikeTable === true,
      baseHasWeeklyLikeTable: discovery.hasWeeklyLikeTable === true,
      baseHasLiteratureLikeTable: discovery.hasLiteratureLikeTable === true,
      membersTablePresent: members.tablePresent === true,
      membersFieldsReadable: members.fieldsReadable === true,
      membersRecordReadable: members.recordReadReadable === true,
      membersSchemaOk: members.schemaOk === true,
      weeklyTablePresent: weekly.tablePresent === true,
      weeklyFieldsReadable: weekly.fieldsReadable === true,
      weeklyRecordReadable: weekly.recordReadReadable === true,
      weeklySchemaOk: weekly.schemaOk === true,
      ai: AI_STATUS,
      stabilization: {
        version: 2,
        mode: 'shadow',
        productionCutover: false,
        writesEnabled: false,
        deep: {
          authOk: deep.auth?.ok === true,
          locatorOk: deep.locator?.ok === true,
          appMetadataOk: deep.appMetadata?.ok === true,
          discovery,
          members,
          weekly,
          errorStage: deep.errorStage || '',
          errorCode: deep.errorCode || ''
        }
      },
      professorDigest: { format: DIGEST_VERSION, source: 'submitted_student_text', aiEnabled: false,
        timezone: 'Asia/Shanghai', scheduled: 'Friday 18:00', longContent: 'split_without_truncation' }
    }), { status: response.status, headers });
  },
  async scheduled(controller, env, ctx) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(controller.scheduledTime)).map((part) => [part.type, part.value]));
    if (parts.weekday !== 'Fri') return;
    if (parts.hour === '18') {
      ctx.waitUntil(runProfessorDigest(controller.scheduledTime, env));
    } else if (parts.hour === '11') {
      await legacy.scheduled(controller, env, ctx);
    }
  }
};
