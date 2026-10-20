/* global fetch, AbortSignal */
import { readFileSync } from 'node:fs';
import { validatePRBody } from './policy.mjs';
const repository = 'silverThunder09/ai-interview-studio';
const input = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs;
if (process.env.GITHUB_REPOSITORY !== repository || !/^[1-9][0-9]*$/.test(input?.pr ?? '') || !process.env.GH_TOKEN) throw new Error('Invalid CI request');
const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${input.pr}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
if (!response.ok) throw new Error(`PR query HTTP ${response.status}`);
const pr = await response.json();
if (pr.head.sha !== input.head || pr.base.sha !== input.base || pr.merge_commit_sha !== input.checkout || pr.head.repo.full_name !== repository || pr.base.repo.full_name !== repository || pr.base.ref !== 'main') throw new Error('Stale CI request');
if (validatePRBody(pr.body).length) throw new Error('PR template sections are incomplete');
console.log('Actual PR template validated.');
