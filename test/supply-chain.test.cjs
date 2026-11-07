'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateSupplyChain, readConfiguration } = require('../scripts/verify-supply-chain.cjs');

const sha = 'a'.repeat(40);
const integrity = `sha512-${Buffer.alloc(64, 3).toString('base64')}`;
const action = (name, options = {}) => ({ uses: `${name}@${sha}`, ...options });
const checkout = () => action('actions/checkout', { with: { 'persist-credentials': false } });
const command = filename => `node scripts/verify-attestation.cjs --artifact "release-files/Ravenshelf-1.0.0-Windows.exe" --commit "$env:GITHUB_SHA" --workflow .github/workflows/${filename}\nif ($LASTEXITCODE -ne 0) { throw 'Verification failed.' }\n`;

function buildWorkflow(filename) {
  const publish = filename === 'publish-release.yml';
  const artifact = 'fixture-${{ github.run_id }}-${{ github.run_attempt }}';
  const download = () => action('actions/download-artifact', { with: { name: artifact, path: 'release-files' } });
  const jobs = {
    'verify-source': { uses: './.github/workflows/source-integrity.yml', permissions: { contents: 'read', 'pull-requests': 'read' } },
    build: { needs: publish ? 'verify-checks' : 'verify-source', steps: [checkout(), { run: 'npm ci\nnpm test\nnpm audit --audit-level=high\nnpm audit signatures' }, action('actions/upload-artifact', { with: { name: artifact } })] },
    attest: { needs: 'build', permissions: { contents: 'read', 'id-token': 'write', attestations: 'write' }, steps: [download(), action('actions/attest-build-provenance', { with: { 'subject-path': 'release-files/*.exe' } })] },
    [publish ? 'release' : 'verify']: { needs: 'attest', permissions: { contents: publish ? 'write' : 'read', attestations: 'read' }, steps: [checkout(), download(), { run: command(filename) }, ...(publish ? [action('actions/github-script', { with: { script: 'await github.rest.repos.createRelease({});' } })] : [])] }
  };
  if (publish) jobs['verify-checks'] = { needs: 'verify-source', steps: [action('actions/github-script', { with: { script: 'await github.rest.actions.listWorkflowRuns({});' } })] };
  return { on: { workflow_dispatch: null }, permissions: { contents: 'read' }, jobs };
}

function fixture() {
  const packageJson = { name: 'fixture-app', version: '1.0.0', dependencies: { 'fixture-runtime': '1.2.3' }, devDependencies: { 'fixture-tools': '2.3.4' } };
  return {
    packageJson,
    packageLock: { name: packageJson.name, version: packageJson.version, lockfileVersion: 3, packages: {
      '': structuredClone(packageJson),
      'node_modules/fixture-runtime': { version: '1.2.3', resolved: 'https://registry.npmjs.org/fixture-runtime/-/fixture-runtime-1.2.3.tgz', integrity },
      'node_modules/fixture-tools': { version: '2.3.4', resolved: 'https://registry.npmjs.org/fixture-tools/-/fixture-tools-2.3.4.tgz', integrity }
    } },
    dependabot: { version: 2, updates: ['npm', 'github-actions'].map(ecosystem => ({ 'package-ecosystem': ecosystem, directory: '/', schedule: { interval: 'weekly' }, groups: { compatible: { 'update-types': ['minor', 'patch'] } } })) },
    workflows: {
      'test.yml': { on: ['push', 'pull_request'], permissions: { contents: 'read' }, jobs: { test: { steps: [checkout(), { run: 'npm ci\nnpm test\nnpm audit --audit-level=high\nnpm audit signatures' }] } } },
      'codeql.yml': { on: 'push', permissions: { contents: 'read' }, jobs: { analyze: { permissions: { contents: 'read', 'security-events': 'write' }, steps: [checkout(), action('github/codeql-action/init'), action('github/codeql-action/analyze')] } } },
      'source-integrity.yml': { on: { workflow_call: null, push: null }, permissions: { contents: 'read' }, jobs: { verify: { steps: [action('actions/github-script', { with: { script: '/* API-only source gate fixture. */' } })] } } },
      'build-windows.yml': buildWorkflow('build-windows.yml'),
      'publish-release.yml': buildWorkflow('publish-release.yml')
    }
  };
}

function rejected(mutate, expected) {
  const config = fixture();
  mutate(config);
  let result;
  assert.doesNotThrow(() => { result = validateSupplyChain(config); });
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), expected);
}
const workflow = (config, filename = 'publish-release.yml') => config.workflows[filename];
const verification = config => workflow(config).jobs.release.steps[2];

test('current repository configuration and independent valid fixture satisfy policy', () => {
  for (const config of [readConfiguration(), fixture()]) assert.deepEqual(validateSupplyChain(config), { valid: true, errors: [] });
});

test('validator is pure and accepts synchronized exact version updates', () => {
  const config = fixture();
  config.packageJson.version = config.packageLock.version = config.packageLock.packages[''].version = '2.0.0-beta.1+review.2';
  config.packageJson.devDependencies['fixture-tools'] = config.packageLock.packages[''].devDependencies['fixture-tools'] = '3.0.0';
  config.packageLock.packages['node_modules/fixture-tools'].version = '3.0.0';
  config.packageLock.packages['node_modules/fixture-tools'].resolved = 'https://registry.npmjs.org/fixture-tools/-/fixture-tools-3.0.0.tgz';
  const before = JSON.stringify(config);
  assert.equal(validateSupplyChain(config).valid, true);
  assert.equal(JSON.stringify(config), before);
});

test('consistent action SHA updates are accepted without hardcoded revision values', () => {
  const config = fixture();
  for (const item of Object.values(config.workflows)) for (const job of Object.values(item.jobs)) for (const step of job.steps || []) if (step.uses) step.uses = step.uses.replace(sha, 'b'.repeat(40));
  assert.equal(validateSupplyChain(config).valid, true);
});

test('missing top-level and required workflow fields fail closed', () => {
  for (const key of ['packageJson', 'packageLock', 'dependabot', 'workflows']) rejected(config => { delete config[key]; }, /missing|required|object/);
  for (const filename of Object.keys(fixture().workflows)) rejected(config => { delete config.workflows[filename]; }, /Required workflow/);
  for (const config of [undefined, null, [], 'config']) assert.equal(validateSupplyChain(config).valid, false);
});

test('package and lockfile version, root dependency names and values must agree', () => {
  rejected(config => { config.packageLock.version = '9.0.0'; }, /Lockfile name\/version/);
  rejected(config => { config.packageLock.packages[''].version = '9.0.0'; }, /root name\/version/);
  rejected(config => { delete config.packageLock.packages['']; }, /root package is missing/);
  rejected(config => { delete config.packageLock.packages[''].devDependencies; }, /devDependencies must exactly match/);
  rejected(config => { config.packageLock.packages[''].dependencies.extra = '1.0.0'; }, /dependencies must exactly match/);
  rejected(config => { config.packageLock.packages['node_modules/fixture-runtime'].version = '1.2.4'; }, /Locked direct dependency/);
  rejected(config => { config.packageJson.engines = { node: '>=24' }; }, /root engines/);
});

test('direct ranges, tags, aliases and local or git dependency specs are rejected', () => {
  for (const version of ['^1.2.3', '~1.2.3', '*', 'latest', 'npm:other@1.2.3', 'file:../fixture', 'git+https://example.invalid/repo', '1.2', '01.2.3', '1.2.3-beta..1']) {
    rejected(config => { config.packageJson.dependencies['fixture-runtime'] = config.packageLock.packages[''].dependencies['fixture-runtime'] = version; }, /must use an exact version/);
  }
});

test('all installed records including transitive packages require approved registry URLs', () => {
  for (const resolved of [undefined, 'http://registry.npmjs.org/a.tgz', 'https://registry.npmjs.org.example.invalid/a.tgz', 'https://registry.npmjs.org@other.invalid/a.tgz', 'https://user:secret@registry.npmjs.org/a.tgz', 'https://registry.npmjs.org/a.tgz?token=fixture', 'git+https://github.com/fixture/repo', 'file:fixture.tgz']) {
    rejected(config => { config.packageLock.packages['node_modules/transitive-fixture'] = { version: '1.0.0', resolved, integrity }; }, /HTTPS npm registry tarball/);
  }
});

test('missing, weak, truncated and noncanonical registry integrity are rejected', () => {
  for (const value of [undefined, '', 'sha1-fixture', 'sha512-aA==', `sha512-${'!'.repeat(86)}==`, `${integrity} sha1-other`]) {
    rejected(config => { config.packageLock.packages['node_modules/fixture-runtime'].integrity = value; }, /SHA-512 integrity/);
  }
  rejected(config => { config.packageLock.packages['node_modules/fixture-runtime'].link = true; }, /must not be a local link/);
});

test('Dependabot root npm and action schedules must remain enabled and weekly', () => {
  rejected(config => { config.dependabot.version = 1; }, /Dependabot version 2/);
  rejected(config => { config.dependabot.updates.pop(); }, /root github-actions/);
  rejected(config => { config.dependabot.updates[0].directory = '/nested'; }, /root npm/);
  rejected(config => { config.dependabot.updates[0].schedule.interval = 'monthly'; }, /must check weekly/);
  rejected(config => { config.dependabot.updates[0]['open-pull-requests-limit'] = 0; }, /must not disable/);
});

test('Dependabot groups keep majors separate without quietly ignoring updates', () => {
  for (const group of [{}, { 'update-types': ['major', 'minor', 'patch'] }, { 'update-types': ['minor'] }, { 'update-types': ['minor', 'minor'] }]) {
    rejected(config => { config.dependabot.updates[0].groups.compatible = group; }, /only minor and patch/);
  }
  rejected(config => { delete config.dependabot.updates[1].groups; }, /must group minor and patch/);
  rejected(config => { config.dependabot.updates[0].ignore = [{ 'dependency-name': '*', 'update-types': ['version-update:semver-major'] }]; }, /must not silently ignore/);
  rejected(config => { config.dependabot.updates[0].allow = [{ 'dependency-name': 'one-package' }]; }, /must cover all/);
});

test('privileged indirect workflow triggers are rejected in every YAML representation', () => {
  for (const trigger of ['pull_request_target', ['push', 'workflow_run'], { pull_request_target: { types: ['opened'] } }]) {
    rejected(config => { config.workflows['test.yml'].on = trigger; }, /privileged indirect events/);
  }
});

test('unapproved, local, floating and partial-SHA actions are rejected', () => {
  for (const uses of ['actions/checkout@v7', 'actions/checkout@abcdef1', `unreviewed/action@${sha}`, './local/action', 'docker://example:latest']) {
    rejected(config => { config.workflows['test.yml'].jobs.test.steps[0].uses = uses; }, /approved action pinned/);
  }
});

test('same action repository must use the same SHA across subpaths and workflows', () => {
  rejected(config => { config.workflows['codeql.yml'].jobs.analyze.steps[2].uses = `github/codeql-action/analyze@${'b'.repeat(40)}`; }, /same github\/codeql-action commit/);
  rejected(config => { config.workflows['test.yml'].jobs.test.steps[0].uses = `actions/checkout@${'b'.repeat(40)}`; }, /same actions\/checkout commit/);
});

test('every checkout explicitly disables credential persistence', () => {
  for (const value of [undefined, true, 'false', '${{ false }}']) rejected(config => { config.workflows['test.yml'].jobs.test.steps[0].with['persist-credentials'] = value; }, /disable persisted/);
});

test('missing or broad workflow and job permissions fail closed', () => {
  rejected(config => { delete config.workflows['test.yml'].permissions; }, /explicit restricted permissions/);
  rejected(config => { config.workflows['test.yml'].jobs.test.permissions = 'write-all'; }, /explicit restricted permissions/);
  rejected(config => { config.workflows['test.yml'].jobs.test.permissions = { contents: '${{ inputs.permission }}' }; }, /invalid permission values/);
});

test('npm installation is forbidden with inherited or job-scoped write credentials', () => {
  for (const scope of ['contents', 'id-token', 'attestations']) for (const run of ['npm ci', 'npm install', 'npm.cmd --prefix . ci', 'npm i', 'npm clean-install']) {
    rejected(config => { config.workflows['test.yml'].permissions[scope] = 'write'; config.workflows['test.yml'].jobs.test.steps[1].run = run; }, /must not install dependencies/);
  }
  rejected(config => { const job = config.workflows['test.yml'].jobs.test; job.permissions = { contents: 'write' }; job.steps[1] = action('actions/github-script', { with: { script: "execSync('npm ci');" } }); }, /must not install dependencies/);
  const config = fixture();
  config.workflows['test.yml'].permissions.contents = 'write';
  config.workflows['test.yml'].jobs.test.permissions = { contents: 'read' };
  assert.equal(validateSupplyChain(config).valid, true, 'job permissions replace workflow permissions');
});

test('preview and release builds require an actual reusable source verification gate', () => {
  for (const filename of ['build-windows.yml', 'publish-release.yml']) {
    rejected(config => { delete workflow(config, filename).jobs['verify-source']; }, /verified-source gate/);
    rejected(config => { delete workflow(config, filename).jobs.build.needs; }, /build must depend on verified source/);
    rejected(config => { workflow(config, filename).jobs['verify-source'].uses = './.github/workflows/test.yml'; }, /unreviewed reusable workflow/);
    rejected(config => { workflow(config, filename).jobs['verify-source']['continue-on-error'] = true; }, /mandatory verified-source gate/);
  }
});

test('intermediate gates cannot ignore failures or force continuation after skipped checks', () => {
  rejected(config => { workflow(config).jobs['verify-checks']['continue-on-error'] = '${{ true }}'; }, /preserve source-gate failure/);
  rejected(config => { workflow(config).jobs['verify-checks'].if = '${{ always() }}'; }, /preserve source-gate failure/);
  rejected(config => { workflow(config).jobs.release.if = '${{ failure() }}'; }, /stop after a failed/);
  rejected(config => { workflow(config).jobs['verify-source'].secrets = 'inherit'; }, /inherited secrets/);
});

test('missing and cyclic job prerequisites fail without recursing forever', () => {
  rejected(config => { workflow(config).jobs.build.needs = 'missing-job'; }, /missing or cyclic/);
  rejected(config => { workflow(config).jobs['verify-checks'].needs = 'build'; }, /missing or cyclic/);
  rejected(config => { workflow(config).jobs.build.needs = ['build']; }, /missing or cyclic/);
});

test('attestation credentials are isolated from checkout and all executable commands', () => {
  rejected(config => { workflow(config).jobs.attest.steps.unshift(checkout()); }, /only download and attest/);
  rejected(config => { workflow(config).jobs.attest.steps.push({ run: 'node scripts/build-updater.cjs' }); }, /only download and attest/);
  rejected(config => { workflow(config).jobs.attest.permissions.contents = 'write'; }, /required credential scopes/);
  rejected(config => { workflow(config).jobs.attest.permissions.packages = 'write'; }, /additional permission scopes/);
  rejected(config => { workflow(config).jobs.attest.steps[1]['continue-on-error'] = true; }, /only download and attest/);
});

test('verification waits for attestation and consumes only the same current-run artifact', () => {
  rejected(config => { workflow(config).jobs.release.needs = 'build'; }, /finish building and attesting/);
  rejected(config => { workflow(config).jobs.attest.steps[0].with.name = 'other-artifact'; }, /same named artifact/);
  rejected(config => { workflow(config).jobs.release.steps[1].with['run-id'] = 123; }, /only from its current run/);
  rejected(config => { workflow(config).jobs.attest.steps[0].with.repository = 'other/repository'; }, /only from its current run/);
});

test('artifact verification must run and fail closed rather than merely appear in a comment', () => {
  rejected(config => { workflow(config).jobs.release.steps.splice(2, 1); }, /run artifact signature verification/);
  rejected(config => { verification(config).run = `# ${command('publish-release.yml')}`; }, /run artifact signature verification/);
  rejected(config => { verification(config).run = command('publish-release.yml').split('\n')[0]; }, /run artifact signature verification/);
  rejected(config => { verification(config)['continue-on-error'] = true; }, /unconditional and fail closed/);
  rejected(config => { verification(config).if = '${{ inputs.verify }}'; }, /unconditional and fail closed/);
});

test('artifact verifier arguments bind the correct source and workflow without extra commands', () => {
  rejected(config => { verification(config).run = command('build-windows.yml'); }, /run artifact signature verification/);
  rejected(config => { verification(config).run = command('publish-release.yml').replace('$env:GITHUB_SHA', '0'.repeat(40)); }, /run artifact signature verification/);
  rejected(config => { verification(config).run = command('publish-release.yml').replace('--artifact', '--commit fixture --artifact'); }, /pin this workflow/);
  rejected(config => { verification(config).run = command('publish-release.yml').replace('\n', ' || true\n'); }, /pin this workflow/);
});

test('publication cannot precede the required positive artifact verification', () => {
  rejected(config => { const steps = workflow(config).jobs.release.steps; [steps[2], steps[3]] = [steps[3], steps[2]]; }, /before running publication commands/);
});

test('preview expected-failure checks can follow the mandatory positive verification', () => {
  const config = fixture();
  workflow(config, 'build-windows.yml').jobs.verify.steps.push({ run: `${command('build-windows.yml').split('\n')[0].replace('"$env:GITHUB_SHA"', '0'.repeat(40))}\nif ($LASTEXITCODE -eq 0) { throw 'Wrong source unexpectedly accepted.' }\n${command('publish-release.yml').split('\n')[0]}\nif ($LASTEXITCODE -eq 0) { throw 'Wrong signer unexpectedly accepted.' }\nexit 0` });
  assert.equal(validateSupplyChain(config).valid, true);
  rejected(value => { workflow(value).jobs.release.steps.push({ run: command('publish-release.yml').replace('-ne 0', '-eq 0') }); }, /two explicit preview rejection checks/);
});

test('tests and both audits cannot be omitted, skipped or moved after artifact upload', () => {
  for (const filename of ['test.yml', 'build-windows.yml', 'publish-release.yml']) {
    const id = filename === 'test.yml' ? 'test' : 'build';
    for (const removed of ['npm ci', 'npm test', 'npm audit --audit-level=high', 'npm audit signatures']) {
      rejected(config => { workflow(config, filename).jobs[id].steps[1].run = workflow(config, filename).jobs[id].steps[1].run.replace(removed, '# removed'); }, /unconditionally before uploading/);
    }
    rejected(config => { workflow(config, filename).jobs[id].steps[1]['continue-on-error'] = true; }, /unconditionally before uploading/);
    rejected(config => { workflow(config, filename).jobs[id].steps[1].if = '${{ inputs.audit }}'; }, /unconditionally before uploading/);
  }
  rejected(config => { const steps = workflow(config).jobs.build.steps; [steps[1], steps[2]] = [steps[2], steps[1]]; }, /unconditionally before uploading/);
});

test('malformed nested maps, jobs and steps return policy errors without crashing', () => {
  for (const value of [null, [], 'invalid']) {
    rejected(config => { config.packageLock.packages = value; }, /root package is missing/);
    rejected(config => { workflow(config).jobs.build.steps = value; }, /must have steps/);
    rejected(config => { workflow(config).jobs.release.steps[0] = value; }, /exactly one action or command/);
    rejected(config => { config.dependabot.updates[0].groups = value; }, /must group/);
  }
});

test('CLI validates the current repository and refuses command-line policy overrides', () => {
  const script = path.resolve(__dirname, '../scripts/verify-supply-chain.cjs');
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8', windowsHide: true, timeout: 10000 }), /checks passed/);
  const rejectedRun = spawnSync(process.execPath, [script, '--ignore-policy'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.equal(rejectedRun.status, 1);
  assert.match(rejectedRun.stderr, /could not be read or validated/);
});
