# Contributing to Ravenshelf

Bug reports, focused fixes and documentation improvements are welcome. Read the [user guide](docs/USER-GUIDE.md) and [build instructions](docs/BUILDING.md) before changing the app.

## Report a problem

Open an [issue](https://github.com/khattabhunter/ravenshelf/issues) with:

- The Ravenshelf version and Windows version.
- What you expected and what happened instead.
- The shortest steps that reproduce the problem.
- The visible error text and, if useful, a screenshot with personal information removed.

For host problems, name the host and describe the step that fails. Prefer a synthetic or harmless public example. Do not attach browser cookies, authorization headers, signed download URLs, the app profile, `library.json`, installed-game scan results or personal file paths. Check logs and screenshots before posting them publicly.

Do not post sensitive security findings or secrets in a public issue. Use private vulnerability reporting if it is available for this repository; otherwise ask the maintainer for a private reporting route without including sensitive details.

## Submit a change

1. Fork the repository and create a focused branch.
2. Install locked dependencies with `npm ci`.
3. Make the smallest complete change that addresses the problem.
4. Add or update meaningful tests for behavior that can regress, especially download integrity and host boundaries.
5. Run `npm test`. For application changes, also check the affected flow in a separate profile; see [BUILDING.md](docs/BUILDING.md).
6. Open a pull request describing the problem, resulting behavior and validation performed.

Keep download and browser protections intact. Host HTML, filenames, URLs and responses are untrusted data. Do not solve a compatibility problem by marking unverified files ready, weakening URL checks, ignoring inconsistent ranges or executing downloaded files.

Use synthetic fixtures instead of personal profiles or whole captured host pages. Keep the normal test suite offline. Discuss new runtime dependencies and large feature changes before committing a broad implementation.

## License

Contributions to Ravenshelf's original code are submitted under the repository's [MIT License](LICENSE). Preserve third-party notices and include appropriate attribution for any separately licensed material you add.
