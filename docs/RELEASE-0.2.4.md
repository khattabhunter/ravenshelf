# Atlas Library 0.2.4 — Privacy hardening preview

Download **Atlas-Library-0.2.4-Windows.exe** from the assets below. Close the older Atlas instance, then open this portable Windows x64 build. Your existing local library and queue are retained. The executable is unsigned; keep Windows security protections enabled.

[User guide](https://github.com/khattabhunter/atlas-library/blob/main/docs/USER-GUIDE.md) · [Privacy and data handling](https://github.com/khattabhunter/atlas-library/blob/main/docs/PRIVACY.md) · [Build from source](https://github.com/khattabhunter/atlas-library/blob/main/docs/BUILDING.md)

## Changes

- Cover images now load through Atlas's restricted image loader instead of direct browser requests.
- Image requests and redirects use the same public-network checks as downloads. Local and private network destinations are blocked.
- Image responses must contain a supported raster image, with a size limit and timeout. HTML and SVG responses are rejected.
- Image requests do not forward the protected browser's cookies, credentials or referrer.
- Added a privacy guide explaining local storage, public repository contents and normal network visibility.

## Privacy limits

This update does not hide your connection's IP address from websites. The catalogue, image providers, file hosts and YouTube can see the address used to connect to them. Atlas does not enforce a VPN or proxy.

Your library, installed-game inventory and browser sessions stay in your local profile; they are not part of the source or release. Other programs with access to your Windows account may still read local application data. Atlas is not an antivirus or a guarantee against all software vulnerabilities.

## Verification

The release workflow runs the offline test suite on Windows before packaging. The executable is built from the tagged source on GitHub's hosted build machines. **SHA256SUMS.txt** provides the exact executable checksum; GitHub generates the source archives from this tag.
