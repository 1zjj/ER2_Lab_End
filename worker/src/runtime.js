import legacy from './index.js';
import { runProfessorDigest, DIGEST_VERSION } from './professor-digest.js';

// Intentional source-level pause: flipping an environment variable alone cannot enable AI.
// Preserve the plan and any existing external credentials; never delete them in this release.
export const AI_STATUS = Object.freeze({ enabled: false, status: 'paused', configurationRetained: true });

function aiPaused(request, env) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
  try { headers.set('Access-Control-Allow-Origin', new URL(env.FRONTEND_URL).origin); } catch (_) { /* No configured frontend. */ }
  return new Response(JSON.stringify({ code: 'AI_PAUSED', message: 'AI 功能暂未启用，相关设计与配置保留。', ai: AI_STATUS }), { status: 503, headers });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'OPTIONS' && /^\/api\/ai(?:\/|$)/.test(path)) return aiPaused(request, env);
    const response = await legacy.fetch(request, env, ctx);
    if (path !== '/health' || !response.ok) return response;
    const body = await response.json();
    const headers = new Headers(response.headers);
    return new Response(JSON.stringify({ ...body, ai: AI_STATUS,
      professorDigest: { format: DIGEST_VERSION, source: 'submitted_student_text', aiEnabled: false,
        timezone: 'Asia/Shanghai', scheduled: 'Friday 18:00', longContent: 'split_without_truncation' } }),
      { status: response.status, headers });
  },
  async scheduled(controller, env, ctx) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(controller.scheduledTime)).map((part) => [part.type, part.value]));
    if (parts.weekday !== 'Fri') return;
    if (parts.hour === '18') {
      ctx.waitUntil(runProfessorDigest(controller.scheduledTime, env));
    } else if (parts.hour === '11') {
      // Preserve the existing Friday reminder, onboarding, courses and all authenticated APIs.
      await legacy.scheduled(controller, env, ctx);
    }
  }
};
