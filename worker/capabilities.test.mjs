import assert from 'node:assert/strict';
import { courseCapabilities } from './src/capabilities.js';
const env = { COURSES_TABLE_ID: 'courses', COURSES_BASE_APP_TOKEN: 'base', COURSE_REVIEWER_OPEN_ID: 'ou_reviewer', PROFESSOR_OPEN_ID: 'ou_professor' };
assert.equal(courseCapabilities(env).submissionEnabled, true);
for (const field of Object.keys(env)) assert.equal(courseCapabilities({ ...env, [field]: '' }).submissionEnabled, false);
assert.equal(courseCapabilities({ ...env, COURSES_BASE_APP_TOKEN: '', FEISHU_BASE_APP_TOKEN: 'global' }).submissionEnabled, false);
assert.equal(courseCapabilities({ ...env, COURSES_BASE_APP_TOKEN: '', COURSES_BASE_WIKI_TOKEN: 'wiki' }).submissionEnabled, true);
console.log('PASS course capability: explicit table and reviewer configuration required; legacy global locator cannot enable writes');
