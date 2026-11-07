'use strict';

// This is a configuration regression check, not an interpreter or a substitute
// for reviewing workflow code, verifying signatures, or protecting main.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ACTIONS = new Set([
  'actions/checkout', 'actions/setup-node', 'actions/github-script',
  'actions/upload-artifact', 'actions/download-artifact',
  'actions/attest-build-provenance', 'github/codeql-action/init',
  'github/codeql-action/analyze'
]);
const REQUIRED_WORKFLOWS = [
  'build-windows.yml', 'publish-release.yml', 'source-integrity.yml',
  'test.yml', 'codeql.yml'
];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const NUMBER = '(?:0|[1-9][0-9]*)';
const PRERELEASE = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const EXACT_VERSION = new RegExp(`^${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-${PRERELEASE}(?:\\.${PRERELEASE})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => object(value) && Object.hasOwn(value, key);
const actionName = step => typeof step?.uses === 'string' ? step.uses.split('@')[0] : '';
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const unconditional = value => value === undefined || value === true || /^\s*(?:\$\{\{\s*)?success\(\)(?:\s*\}\})?\s*$/.test(String(value));
const noIgnoredFailure = value => value === undefined || value === false;

function validateSupplyChain(config) {
  const errors = [];
  const check = (condition, message) => { if (!condition) errors.push(message); };
  if (!object(config)) return { valid: false, errors: ['Supply-chain configuration is missing.'] };
  const { packageJson: pkg, packageLock: lock, dependabot, workflows } = config;

  check(object(pkg), 'package.json must be an object.');
  check(object(lock), 'package-lock.json must be an object.');
  if (object(pkg) && object(lock)) {
    check(nonempty(pkg.name) && typeof pkg.version === 'string' && EXACT_VERSION.test(pkg.version), 'Package name and exact version are required.');
    check(lock.name === pkg.name && lock.version === pkg.version, 'Lockfile name/version must match package.json.');
    check([2, 3].includes(lock.lockfileVersion), 'A package-map lockfile is required.');
    const packages = object(lock.packages) ? lock.packages : {};
    const root = packages[''];
    check(object(root), 'Lockfile root package is missing.');
    if (object(root)) {
      check(root.name === pkg.name && root.version === pkg.version, 'Lockfile root name/version must match package.json.');
      const engineMap = value => object(value) ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b)) : value;
      check(JSON.stringify(engineMap(root.engines)) === JSON.stringify(engineMap(pkg.engines)), 'Lockfile root engines must match package.json.');
      for (const field of DEPENDENCY_FIELDS) {
        const wanted = pkg[field] === undefined ? {} : pkg[field];
        const actual = root[field] === undefined ? {} : root[field];
        check(object(wanted) && object(actual), `Package and lockfile ${field} must be dependency maps.`);
        if (!object(wanted) || !object(actual)) continue;
        const names = Object.keys(wanted).sort();
        check(JSON.stringify(names) === JSON.stringify(Object.keys(actual).sort()) && names.every(name => wanted[name] === actual[name]), `Lockfile root ${field} must exactly match package.json.`);
        for (const name of names) {
          check(typeof wanted[name] === 'string' && EXACT_VERSION.test(wanted[name]), `Direct ${field} entry ${name} must use an exact version.`);
          const installed = packages[`node_modules/${name}`];
          check(object(installed) && installed.version === wanted[name], `Locked direct dependency ${name} must match its declared version.`);
        }
      }
    }
    for (const [location, entry] of Object.entries(packages)) {
      if (location === '') continue;
      const label = `Locked package ${location}`;
      check(location.startsWith('node_modules/') && object(entry), `${label} has an invalid location or record.`);
      if (!object(entry)) continue;
      check(entry.link === undefined || entry.link === false, `${label} must not be a local link.`);
      check(typeof entry.version === 'string' && EXACT_VERSION.test(entry.version), `${label} must have an exact registry version.`);
      let registry = false;
      try {
        const url = new URL(entry.resolved);
        registry = url.protocol === 'https:' && url.host === 'registry.npmjs.org' && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('.tgz');
      } catch { /* Missing or non-URL resolutions fail closed. */ }
      check(registry, `${label} must resolve to an HTTPS npm registry tarball.`);
      const digest = typeof entry.integrity === 'string' ? entry.integrity.slice(7) : '';
      check(typeof entry.integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity) && Buffer.from(digest, 'base64').toString('base64') === digest, `${label} must have a canonical SHA-512 integrity digest.`);
    }
  }

  check(object(dependabot) && dependabot.version === 2 && Array.isArray(dependabot.updates), 'Dependabot version 2 with updates is required.');
  if (Array.isArray(dependabot?.updates)) {
    for (const ecosystem of ['npm', 'github-actions']) {
      const updates = dependabot.updates.filter(update => object(update) && update['package-ecosystem'] === ecosystem && update.directory === '/');
      check(updates.length === 1, `Dependabot must have exactly one root ${ecosystem} configuration.`);
      for (const update of updates) {
        check(update.schedule?.interval === 'weekly', `Dependabot ${ecosystem} must check weekly.`);
        check(update['open-pull-requests-limit'] === undefined || (Number.isInteger(update['open-pull-requests-limit']) && update['open-pull-requests-limit'] > 0), `Dependabot ${ecosystem} must not disable version updates.`);
        check(update.ignore === undefined || (Array.isArray(update.ignore) && update.ignore.length === 0), `Dependabot ${ecosystem} must not silently ignore dependency updates.`);
        check(update.allow === undefined, `Dependabot ${ecosystem} must cover all direct and transitive dependencies.`);
        check(object(update.groups) && Object.keys(update.groups).length > 0, `Dependabot ${ecosystem} must group minor and patch updates.`);
        for (const group of Object.values(object(update.groups) ? update.groups : {})) {
          check(object(group) && Array.isArray(group['update-types']) && group['update-types'].length === 2 && new Set(group['update-types']).size === 2 && group['update-types'].every(type => ['minor', 'patch'].includes(type)), `Dependabot ${ecosystem} groups must contain only minor and patch updates; majors stay separate.`);
        }
      }
    }
    check(dependabot.updates.length === 2, 'Dependabot must use only the reviewed root npm and github-actions configurations.');
  }

  check(object(workflows), 'Workflow configuration is missing.');
  if (!object(workflows)) return { valid: errors.length === 0, errors };
  for (const filename of REQUIRED_WORKFLOWS) check(own(workflows, filename), `Required workflow ${filename} is missing.`);
  const pins = new Map();
  for (const [filename, workflow] of Object.entries(workflows)) {
    const prefix = `Workflow ${filename}`;
    check(object(workflow), `${prefix} must be an object.`);
    if (!object(workflow)) continue;
    const events = typeof workflow.on === 'string' ? [workflow.on] : Array.isArray(workflow.on) ? workflow.on : object(workflow.on) ? Object.keys(workflow.on) : [];
    check(events.length > 0 && events.every(event => typeof event === 'string'), `${prefix} must declare its events.`);
    check(!events.some(event => ['pull_request_target', 'workflow_run'].includes(event)), `${prefix} must not execute privileged indirect events.`);
    check(object(workflow.permissions), `${prefix} must declare explicit restricted permissions.`);
    check(object(workflow.jobs) && Object.keys(workflow.jobs).length > 0, `${prefix} must have jobs.`);
    if (!object(workflow.jobs)) continue;
    const jobs = workflow.jobs;
    const needs = job => typeof job?.needs === 'string' ? [job.needs] : Array.isArray(job?.needs) ? job.needs : [];
    const dependsOn = (id, ancestor, seen = new Set()) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return needs(jobs[id]).some(parent => typeof parent === 'string' && (parent === ancestor || dependsOn(parent, ancestor, seen)));
    };
    for (const [id, job] of Object.entries(jobs)) {
      const label = `${prefix} job ${id}`;
      check(object(job), `${label} must be an object.`);
      if (!object(job)) continue;
      check(job.needs === undefined || nonempty(job.needs) || (Array.isArray(job.needs) && job.needs.length > 0 && job.needs.every(nonempty)), `${label} has invalid prerequisites.`);
      check(needs(job).every(parent => own(jobs, parent) && parent !== id) && !dependsOn(id, id), `${label} has missing or cyclic prerequisites.`);
      const permissions = job.permissions === undefined ? workflow.permissions : job.permissions;
      check(object(permissions), `${label} must use explicit restricted permissions.`);
      if (object(permissions)) check(Object.values(permissions).every(value => ['read', 'write', 'none'].includes(value)), `${label} has invalid permission values.`);
      const privileged = object(permissions) && ['contents', 'id-token', 'attestations'].some(scope => permissions[scope] === 'write');
      if (job.uses !== undefined) {
        check(job.uses === './.github/workflows/source-integrity.yml' && id === 'verify-source' && ['build-windows.yml', 'publish-release.yml'].includes(filename), `${label} uses an unreviewed reusable workflow.`);
        check(job.steps === undefined && !privileged && job.secrets !== 'inherit', `${label} must call source verification without steps, inherited secrets, or write permissions.`);
        continue;
      }
      check(Array.isArray(job.steps) && job.steps.length > 0, `${label} must have steps.`);
      for (const [index, step] of (Array.isArray(job.steps) ? job.steps : []).entries()) {
        const stepLabel = `${label} step ${index + 1}`;
        check(object(step) && ((typeof step.uses === 'string') !== (typeof step.run === 'string')), `${stepLabel} must declare exactly one action or command.`);
        if (!object(step)) continue;
        if (step.uses !== undefined) {
          const match = typeof step.uses === 'string' && /^([^@]+)@([a-f0-9]{40})$/.exec(step.uses);
          check(Boolean(match) && ACTIONS.has(match[1]), `${stepLabel} must use an approved action pinned to a full commit SHA.`);
          if (match && ACTIONS.has(match[1])) {
            const repository = match[1].split('/').slice(0, 2).join('/');
            check(!pins.has(repository) || pins.get(repository) === match[2], `${stepLabel} must use the same ${repository} commit as other workflows.`);
            pins.set(repository, match[2]);
          }
          if (actionName(step) === 'actions/checkout') check(step.with?.['persist-credentials'] === false, `${stepLabel} must disable persisted checkout credentials.`);
        }
        const commands = [step.run, step.with?.script].filter(value => typeof value === 'string').join('\n');
        check(!privileged || !/\bnpm(?:\.cmd|\.exe)?\b[^\r\n;&|]*\b(?:ci|install|i|ic|clean-install|install-clean)\b/i.test(commands), `${stepLabel} must not install dependencies with publication or attestation credentials.`);
      }
    }

    // Preserve the actual checks as well as their credential boundaries.
    const checkedJob = filename === 'test.yml' ? 'test' : ['build-windows.yml', 'publish-release.yml'].includes(filename) ? 'build' : null;
    if (checkedJob) {
      const steps = Array.isArray(jobs[checkedJob]?.steps) ? jobs[checkedJob].steps : [];
      const uploads = steps.map((step, index) => ({ step, index })).filter(({ step }) => actionName(step) === 'actions/upload-artifact');
      for (const command of ['npm ci', 'npm test', 'npm audit --audit-level=high', 'npm audit signatures']) {
        const matches = steps.map((step, index) => ({ step, index })).filter(({ step }) => typeof step?.run === 'string' && step.run.split(/\r?\n/).some(line => line.trim() === command));
        check(matches.length === 1 && noIgnoredFailure(matches[0].step['continue-on-error']) && unconditional(matches[0].step.if) && uploads.every(upload => upload.index > matches[0].index), `${prefix} ${checkedJob} must run ${command} unconditionally before uploading artifacts.`);
      }
    }

    if (!['build-windows.yml', 'publish-release.yml'].includes(filename)) continue;
    const gate = jobs['verify-source'];
    check(object(gate) && gate.uses === './.github/workflows/source-integrity.yml' && noIgnoredFailure(gate['continue-on-error']), `${prefix} must use a mandatory verified-source gate.`);
    check(object(jobs.build) && dependsOn('build', 'verify-source'), `${prefix} build must depend on verified source.`);
    const terminal = filename === 'publish-release.yml' ? 'release' : 'verify';
    for (const id of ['build', 'attest', terminal]) {
      const job = jobs[id];
      check(object(job), `${prefix} must include the ${id} job.`);
      if (!object(job)) continue;
      check(noIgnoredFailure(job['continue-on-error']) && !(typeof job.if === 'string' && /\b(?:always|failure|cancelled)\s*\(/.test(job.if)), `${prefix} ${id} must stop after a failed or skipped prerequisite.`);
    }
    // Every intermediate prerequisite must also propagate a failed source gate.
    for (const [id, job] of Object.entries(jobs)) {
      if (object(job) && id !== 'verify-source' && dependsOn(id, 'verify-source')) {
        check(noIgnoredFailure(job['continue-on-error']) && !(typeof job.if === 'string' && /\b(?:always|failure|cancelled)\s*\(/.test(job.if)), `${prefix} ${id} must preserve source-gate failure.`);
      }
    }
    check(dependsOn('attest', 'build') && dependsOn(terminal, 'attest'), `${prefix} must finish building and attesting before artifact verification.`);
    const attest = jobs.attest;
    const attestSteps = Array.isArray(attest?.steps) ? attest.steps : [];
    check(attestSteps.length === 2 && actionName(attestSteps[0]) === 'actions/download-artifact' && actionName(attestSteps[1]) === 'actions/attest-build-provenance' && attestSteps.every(step => step.run === undefined && noIgnoredFailure(step['continue-on-error']) && unconditional(step.if)), `${prefix} attestation must only download and attest the tested artifact.`);
    check(attest?.permissions?.contents === 'read' && attest?.permissions?.['id-token'] === 'write' && attest?.permissions?.attestations === 'write', `${prefix} attestation must declare only its required credential scopes.`);
    if (object(attest?.permissions)) check(Object.keys(attest.permissions).every(scope => ['contents', 'id-token', 'attestations'].includes(scope)), `${prefix} attestation must not receive additional permission scopes.`);

    const terminalSteps = Array.isArray(jobs[terminal]?.steps) ? jobs[terminal].steps : [];
    const verification = terminalSteps.map((step, index) => ({ step, index })).filter(({ step }) => {
      if (typeof step?.run !== 'string') return false;
      const lines = step.run.split(/\r?\n/);
      return lines.some((line, lineIndex) => /^\s*node(?:\.exe)?\s+scripts\/verify-attestation\.cjs\s+/.test(line) &&
        line.includes(`--workflow .github/workflows/${filename}`) && /--commit\s+"\$env:GITHUB_SHA"(?:\s|$)/.test(line) &&
        /if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{\s*throw\b/.test(lines.slice(lineIndex + 1).join('\n')));
    });
    check(verification.length === 1, `${prefix} must run artifact signature verification exactly once before publication.`);
    if (verification.length === 1) {
      const { step, index } = verification[0];
      const line = step.run.split(/\r?\n/).find(value => /^\s*node(?:\.exe)?\s+scripts\/verify-attestation\.cjs\s+/.test(value));
      check(noIgnoredFailure(step['continue-on-error']) && unconditional(step.if), `${prefix} artifact verification must be unconditional and fail closed.`);
      check(line.includes(`--workflow .github/workflows/${filename}`) && /--commit\s+"\$env:GITHUB_SHA"(?:\s|$)/.test(line) && ['artifact', 'commit', 'workflow'].every(flag => (line.match(new RegExp(`--${flag}\\b`, 'g')) || []).length === 1) && !/[;&|]/.test(line), `${prefix} artifact verification must pin this workflow and exact source commit.`);
      check(/if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{\s*throw\b/.test(step.run.slice(step.run.indexOf(line) + line.length)), `${prefix} must propagate artifact verifier failure.`);
      for (const [otherIndex, other] of terminalSteps.entries()) {
        if (otherIndex === index) continue;
        if (actionName(other) === 'actions/github-script' || typeof other?.run === 'string') check(otherIndex > index, `${prefix} must verify the artifact before running publication commands.`);
        if (typeof other?.run === 'string' && other.run.includes('scripts/verify-attestation.cjs')) {
          const calls = other.run.split(/\r?\n/).filter(line => /^\s*node(?:\.exe)?\s+scripts\/verify-attestation\.cjs\s+/.test(line));
          const expectedFailures = other.run.match(/if\s*\(\$LASTEXITCODE\s+-eq\s+0\)\s*\{\s*throw\b/g) || [];
          check(filename === 'build-windows.yml' && calls.length === 2 && expectedFailures.length === 2 &&
            calls[0].includes(`--commit ${'0'.repeat(40)} --workflow .github/workflows/build-windows.yml`) &&
            calls[1].includes('--commit "$env:GITHUB_SHA" --workflow .github/workflows/publish-release.yml') &&
            noIgnoredFailure(other['continue-on-error']) && unconditional(other.if), `${prefix} additional verifier calls must be the two explicit preview rejection checks.`);
        }
      }
    }
    const uploads = (Array.isArray(jobs.build?.steps) ? jobs.build.steps : []).filter(step => actionName(step) === 'actions/upload-artifact');
    const downloads = terminalSteps.filter(step => actionName(step) === 'actions/download-artifact');
    check(uploads.length === 1 && downloads.length === 1 && nonempty(uploads[0]?.with?.name) && uploads[0]?.with?.name === attestSteps[0]?.with?.name && uploads[0]?.with?.name === downloads[0]?.with?.name, `${prefix} must build, attest and verify the same named artifact.`);
    for (const step of [attestSteps[0], ...downloads].filter(Boolean)) check(step.with?.['run-id'] === undefined && step.with?.repository === undefined, `${prefix} must download artifacts only from its current run.`);
  }
  return { valid: errors.length === 0, errors };
}

function readConfiguration(root = path.resolve(__dirname, '..')) {
  const read = filename => fs.readFileSync(path.join(root, filename), 'utf8');
  const workflows = Object.fromEntries(fs.readdirSync(path.join(root, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).sort().map(name => [name, yaml.load(read(`.github/workflows/${name}`))]));
  return { packageJson: JSON.parse(read('package.json')), packageLock: JSON.parse(read('package-lock.json')), dependabot: yaml.load(read('.github/dependabot.yml')), workflows };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 2) throw new Error('This policy check does not accept command-line overrides.');
    const result = validateSupplyChain(readConfiguration());
    if (!result.valid) {
      for (const error of result.errors) process.stderr.write(`- ${error}\n`);
      process.exitCode = 1;
    } else process.stdout.write('Supply-chain configuration checks passed.\n');
  } catch {
    process.stderr.write('Supply-chain configuration could not be read or validated.\n');
    process.exitCode = 1;
  }
}

module.exports = { validateSupplyChain, readConfiguration };
