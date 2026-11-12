# Ravenshelf 0.9.0 — Can you run it?

A game's details now compare its Steam requirement lists with this PC, and Ravenshelf warns before you queue files that won't fit on the download drive. Settings, collections, the queue and downloads stay where they are.

- **Can you run it?** Open a game and choose **Compare with this PC**. Each line Ravenshelf recognises in the **Minimum** and **Recommended** lists says **Meets**, **Below** or **Can’t tell**, beside what this PC has. After this PC has been read once, later games are compared as soon as they open.
- **Only figures are compared:** Windows version, 64-bit Windows, memory, graphics memory, DirectX and free space. Processor and graphics card models are not compared (no ranking of them may be included in Ravenshelf), so those lines show both names and say **Can’t tell**.
- **Not enough free space:** when checked files need more room than the download drive has free, Ravenshelf says so, and **Download all** waits until you tick **Queue them anyway**.
- Everything new is in Arabic too.

**Updating from 0.8.0:** open **Settings → Ravenshelf updates** and choose **Download and install**, or download the portable executable below. The browser extension did not change.

**Known limits:** the comparison uses what Windows reports and what the game's Steam listing says; a game without a Steam requirement list cannot be compared. **Meets** means the figures Ravenshelf can read reach the list; it does not promise how well a game runs. Built-in graphics, a graphics device with a problem, usable-only memory that is below the figure, and lines that can be read two ways give **Can’t tell** instead of a guess. The free-space check counts files whose size the host reported, and covers file sets queued from checked links; browser, YouTube and Nexus Mods downloads are not checked.

Download **Ravenshelf-0.9.0-Windows.exe** and compare its SHA-256 with **SHA256SUMS.txt**, or verify its build record with the GitHub CLI as described in the README. The portable executable remains unsigned: the build record shows where the file was built, but it is not Windows publisher signing or a malware verdict. Keep Windows protections enabled.

[User guide: Can you run it?](https://github.com/khattabhunter/ravenshelf/blob/v0.9.0/docs/USER-GUIDE.md#can-you-run-it) · [Privacy](https://github.com/khattabhunter/ravenshelf/blob/v0.9.0/docs/PRIVACY.md) · [Security](https://github.com/khattabhunter/ravenshelf/blob/v0.9.0/SECURITY.md)
