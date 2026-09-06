# Changelog

## 0.4.5

- Resume from the newest saved position, including progress made offline.
- Keep a local resume position after successful synchronization and protect it from delayed responses.
- Save and sync desktop progress when leaving the player, closing the window, or backgrounding the app.
- Keep mobile synchronization running outside the player screen and respond to notification playback controls.
- Save desktop seeks and chapter changes while paused.
- Read embedded chapter titles and boundaries when importing M4B files on desktop. Single-file books share absolute playback offsets with mobile and older clients.
- Keep all linked audiobook copies on the same position, including existing link chains and cycles. Unlinking retains the last shared position.
- Add regression tests and require passing tests and type checks before release deployment.

Self-hosted users should deploy the updated Convex backend alongside the app update. Hosted backend deployment is part of the release workflow.
