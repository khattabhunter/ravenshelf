# Source and release verification

Ravenshelf checks source identity, dependencies and release artifacts separately. A verified commit identifies a signing route; a checksum detects changed bytes; a build attestation ties an artifact to a workflow. None is a malware verdict or a Windows publisher signature.

These source checks apply prospectively. Existing unsigned commits and published releases remain in history. Do not rewrite old commits, move release tags or replace release files to make earlier history appear signed. Releases from 0.4.2 also publish the signed build record that the in-app updater checks; see [the in-app update record](#the-in-app-update-record).

## Verified source before building

The **Source integrity** workflow, [source-integrity.yml](../.github/workflows/source-integrity.yml), checks the exact source commit before a manual Windows preview or release build can proceed. On pull requests it checks all introduced commits, including the actual PR head, rather than GitHub's temporary test-merge commit. Main-branch pushes also receive a check of their exact head commit. The build and release workflows reuse the same verification policy without checking out source or executing dependencies in the signature-check job.

Public release builds also require the latest main-branch push runs of **Test**, **CodeQL** and **Source integrity** to have succeeded for that exact commit. A successful run for an older commit does not satisfy this gate. Wait for the current checks or fix their failures before dispatching publication.

For each checked commit, GitHub's API must report `verification.verified: true`, `reason: "valid"`, and nonempty signature and signed-payload fields. The check records `verified_at` for review. Missing, unsigned, invalid or incomplete results do not pass. PR commit lists are paginated and checked against the declared count; more than 250 commits require a smaller PR rather than silently leaving commits unchecked. See GitHub's [commit verification fields](https://docs.github.com/en/rest/commits/commits) and [PR commit-list limit](https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request).

GitHub-supported GPG, SSH and S/MIME signatures are accepted. Local GPG signing is the recommended setup below, but the workflow does not require OpenPGP armor or a particular personal key. GitHub's verified-signature record persists even if a key later expires or is revoked; this is GitHub's recorded verification, not a fresh assessment of key ownership. Review the author, change and CI results as well as the signature. See [GitHub's signature-verification model](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification).

### GitHub-created commits

Verified commits created through GitHub's web interface or its supported commit API are allowed. GitHub's `createCommitOnBranch` mutation authors the change as the authenticated user, checks an expected branch head, and signs supported commits through GitHub's platform. This is a GitHub platform signature, **not the maintainer's personal GPG signature**. The resulting exact commit must still pass the verification check. See the [GraphQL commit API](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch).

Avoid GitHub's **Rebase and merge** for signed changes: it rewrites commits without signing the replacements. Use a compatible merge route and inspect its resulting signature; any local rewrite must be signed again. A native signed-commit rule can also reject unsigned commits inside a PR even when GitHub would sign the final squash commit. See [GitHub's signed-commit rule](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-signed-commits).

### Repository ruleset rollout

Protect the main branch with required verified commit signatures, blocked force pushes and blocked branch deletion, without bypass actors. Enable these rules only after a maintainer has demonstrated a working signed-commit route and checked bot compatibility. Workflow checks and this document do not themselves activate a hosted ruleset; consult the repository's **Settings → Rules → Rulesets** for its actual state. Existing history is retained. These rules do not require signed release tags or change the release workflow's tag creation.

## Dependabot and action pins

Dependabot checks npm dependencies and GitHub Actions every Monday at 03:00 UTC. Minor/patch version updates are grouped separately for npm and actions; major updates stay in separate PRs. npm minor/patch security updates have their own group. Dependabot signs its own commits by default, including when repository signing is optional. Its signature identifies the bot's change, not the safety of the updated dependency. See [Dependabot security updates](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-security-updates).

Keep full 40-character commit pins on action references and retain the same-line version comments. Update repeated references consistently, including CodeQL's initialization and analysis actions. Dependabot can update those pins and comments; confirm that each new SHA belongs to the intended upstream repository. Review major-version changes and release notes explicitly. This policy does not enable automatic merging. See GitHub's [secure action-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Dependency PRs still need the Windows tests, locked-dependency audit and applicable CodeQL checks. Test, preview and release-build jobs also run `npm audit signatures` to verify registry signatures and available package provenance; this does not mean every package has a publisher provenance attestation. See npm's [registry-signature verification guide](https://docs.npmjs.com/verifying-registry-signatures/). Changes to Electron, packaging or update tooling also need an isolated Windows build/runtime check before release. Do not bypass a failed signature or test check because a PR was opened by Dependabot. The version-update schedule does not by itself enable repository-level security alerts or security-update PRs; those are separate GitHub settings.

Run `npm run verify:supply-chain` after installing the locked dependencies to check configuration consistency locally. It checks dependency versions and lockfile integrity records, Dependabot groups, action pins, permissions and required build/attestation steps. It is a configuration regression check, not a cryptographic verification or a replacement for review. The helper packages `@electron/asar`, `@electron/fuses` and `js-yaml` are explicit development dependencies. From 0.4.2 the app also depends at exact versions on `@sigstore/verify`, `@sigstore/bundle`, `@sigstore/tuf` and `@sigstore/protobuf-specs` to verify update records.

## YouTube helper programs

YouTube downloads (0.6.0) use three programs that Ravenshelf does not bundle: yt-dlp, Deno and the FFmpeg essentials build by Gyan Doshi. `src/media-tools.cjs` pins each to an exact release address on github.com, with the download's size and SHA-256, and, for zip archives, the exact entries to extract with their sizes and SHA-256 values. The values were taken from the downloaded files. For all three downloads they match the SHA-256 digests GitHub records for the release assets, and for yt-dlp and Deno also the publisher's own checksum file (yt-dlp's `SHA2-256SUMS` and Deno's `.sha256sum`). The app downloads them only when the user chooses **Set up**, follows redirects only to GitHub's release download hosts, extracts only the named entries, and installs nothing unless everything matches. From 0.6.1 each download arrives in 2 MiB parts over up to eight HTTP/1.1 connections. Every part request starts again at the github.com address, so each redirect is checked; a part is kept only when the answer is exactly the requested range of a file of the pinned size, and the assembled file is then hashed as a whole before anything is extracted. The installed programs are hashed again before their first use in each session, and Deno is started with `DENO_DISABLE_NODE_SHIM=1` so that it does not add a second name (a hard link) to the checked `deno.exe`.

To move to newer versions, change a program's version, address, size and hashes together in `src/media-tools.cjs`, and record where the hashes came from in the pull request. The install folder name is derived from the whole list, so a new set never mixes with an older one; the older set is removed after the new one installs. Pinned versions are tested against the real archives before release. The publishers' own signing (for example yt-dlp's signed checksum file) is not checked at run time; the hashes in the reviewed source are the trust anchor.

## Separate building, attesting and publishing

The preview and release builders run with read-only repository permission. Each uploads the tested executable and checksum file under a name unique to that workflow run and attempt. A separate job receives the OIDC and attestation-writing permissions, downloads that artifact and attests it. That job does not check out repository code, install dependencies or run build scripts.

Before publication, the release job cryptographically verifies the downloaded artifact's attestation against this repository, the exact release workflow and both the reviewed source and workflow commit. Self-hosted runner attestations are rejected. The preview workflow performs the same verification with its own workflow identity, so the chain can be tested without publishing another app version. The signing job's limited role does not make a malicious build harmless; source review, dependency checks and artifact verification still matter.

## The in-app update record

From 0.4.2, each release also carries `Ravenshelf-<version>-Windows.exe.sigstore.json`: the Sigstore bundle of GitHub's build-provenance attestation for that executable. A separate **Check the build record with the in-app updater** job, with only read permissions, prepares it:

1. GitHub CLI verifies the attestation with the same restrictions as the release job, and `scripts/verify-attestation.cjs --export` saves the bundle it verified. No dependency code runs while that step holds its read-only token.
2. `scripts/verify-update-record.cjs` checks the saved bundle with `src/release-attestation.cjs`, the verifier installed copies use, against both Sigstore's current TUF-signed trusted root and the root bundled with the app, then repeats the check inside the Electron runtime the app ships with, whose BoringSSL behaves differently from Node's OpenSSL. A record that installed copies would refuse stops the release. If Sigstore's TUF service is unreachable, the job warns and relies on the bundled root.
3. The publishing job receives the record's bytes and SHA-256, checks that it is intact and names this executable and checksum, and uploads it beside the executable before the release is published.

Installed copies from 0.4.2 verify this record before downloading an update. They pin the certificate to `https://github.com/khattabhunter/ravenshelf/.github/workflows/publish-release.yml@refs/heads/main`, the issuer `https://token.actions.githubusercontent.com`, a GitHub-hosted runner, and the repository and owner IDs `1448364041` and `76850671`. A release without exactly one valid record is not offered.

Keep these properties when changing the release process. Renaming the workflow file, publishing from another branch, transferring or renaming the repository (which changes its URL), or deleting and re-creating it all produce records that existing installed copies refuse; users would then need to update manually once. Bumping `actions/attest-build-provenance` or the Sigstore packages must keep producing and accepting a verifiable bundle; the release-gate job checks this before every publication.

## Optional local GPG setup for this repository

This setup is for contributors who already have, or deliberately choose to create, a GPG signing key. It is not run by the application or CI. GitHub's [GPG setup guide](https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key) explains associating the key with a verified account email and uploading its **public** key. Never put a private key, passphrase or exported secret key in the repository, workflow secrets, examples or build artifacts.

From this checkout, inspect the available signing keys:

```powershell
gpg --list-secret-keys --keyid-format=long --fingerprint
```

Choose your own full fingerprint and the matching email verified on GitHub. The following commands affect only this repository; they do not change global Git configuration:

```powershell
$signingFingerprint = Read-Host 'Full fingerprint of your GPG signing key'
if ($signingFingerprint -notmatch '^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$') { throw 'Enter the complete key fingerprint.' }
$signingEmail = Read-Host 'Matching email verified on your GitHub account'
if ([string]::IsNullOrWhiteSpace($signingEmail)) { throw 'A verified email is required.' }
git config --local gpg.format openpgp
git config --local user.signingkey $signingFingerprint
git config --local user.email $signingEmail
git config --local commit.gpgsign true
```

The commented [configuration example](../.gitconfig-signing.example) contains no key or active defaults and is not loaded automatically. Do not configure signing until the selected key is available to your Git/GPG installation. If GPG needs a specific executable path, configure it locally after checking your installation; do not copy another machine's path.

Create a real, reviewed change with `git commit -S`, check it with `git verify-commit HEAD`, then check that the same pushed commit is verified by GitHub. A local cryptographic verification and GitHub account verification are separate checks. Do not disable signing silently or rewrite shared history to recover from a setup problem. See [Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits).

## Verify the published executable's build origin

First compare the executable's SHA-256 with the release's `SHA256SUMS.txt`. Then use an up-to-date GitHub CLI to verify the public release attestation, restricting the repository, release workflow, source and workflow commits, certificate issuer and runner type:

```powershell
$artifactPath = Read-Host 'Path to the downloaded Ravenshelf Windows executable'
$reviewedCommit = Read-Host 'Exact 40-character source commit reviewed for this release'
if ($reviewedCommit -notmatch '^[a-fA-F0-9]{40}$') { throw 'An exact source commit is required.' }
$reviewedCommit = $reviewedCommit.ToLowerInvariant()
gh attestation verify $artifactPath `
  --hostname github.com `
  --repo khattabhunter/ravenshelf `
  --signer-workflow github.com/khattabhunter/ravenshelf/.github/workflows/publish-release.yml `
  --source-digest $reviewedCommit `
  --signer-digest $reviewedCommit `
  --predicate-type https://slsa.dev/provenance/v1 `
  --cert-oidc-issuer https://token.actions.githubusercontent.com `
  --deny-self-hosted-runners `
  --digest-alg sha256 `
  --limit 30 `
  --format json
if ($LASTEXITCODE -ne 0) { throw 'Artifact provenance verification failed.' }
```

Use the release's reviewed source commit, not the current branch head. A mismatch is a reason to stop and inspect the release and workflow; do not remove restrictions merely to make the command succeed. The reusable source-check workflow does not produce the attestation: the release workflow above remains its signer. If the attesting workflow changes later, review that change before changing the expected signer. See the [GitHub CLI verification options](https://cli.github.com/manual/gh_attestation_verify).

From a reviewed source checkout, the same check is available through the helper used in CI:

```powershell
node scripts/verify-attestation.cjs --artifact $artifactPath --commit $reviewedCommit --workflow .github/workflows/publish-release.yml
if ($LASTEXITCODE -ne 0) { throw 'Artifact provenance verification failed.' }
```

For an Actions preview artifact, use `.github/workflows/build-windows.yml` as the helper's workflow argument, or the corresponding fully qualified `--signer-workflow` in the manual CLI command. Keep the preview run's exact commit for both digest checks. The helper also checks that the local file remains unchanged and requires a complete verified result from the CLI.

This manual provenance check does not run the executable. From 0.4.2, the in-app updater also verifies the release's signed build record before downloading it, as described above; versions 0.4.1 and earlier check only the expected GitHub repository, release asset, size and SHA-256. Neither source signatures nor attestations provide Windows Authenticode signing; the portable executable remains unsigned.
