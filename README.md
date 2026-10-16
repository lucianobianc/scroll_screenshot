# Scroll Screenshot

A simple Firefox extension that scrolls from your current position and saves the captured portion as one PNG image. Images are processed locally; nothing is uploaded.

## Install in Firefox for development

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select this folder's `manifest.json`.
3. Open a normal web page, click the extension in Firefox's extensions menu, choose a capture mode, then click **Iniciar captura**.
4. Keep the tab visible until the PNG is saved to your Downloads folder. Choose **Até o fim da página**, a height in pixels, or a number of screens. The limit includes the current screen.
5. Press **Esc** on the page (close the popup first if needed), or click **Parar e salvar**, to save only the completed sections. The current frame is always captured before stopping.

Temporary add-ons are removed when Firefox restarts. Distribution requires packaging and Mozilla signing.

## Behavior and limits

- Starts at the current scroll position and captures toward the initial bottom of the page, or the selected height limit, at the current viewport width. When the document does not scroll, automatically selects the largest visible scrolling panel (for example, Discord messages) and captures only that panel. Screen limits use the panel height. Horizontal overflow and additional panels are not expanded.
- Restores your scroll position after capture, including after errors. Fixed and sticky elements appear in the first section and are hidden in later sections to avoid repeated overlays.
- Firefox internal pages, the Mozilla add-ons site, and other protected pages cannot be captured.
- Discord and other apps may virtualize messages or load content while scrolling; these changes can affect the result. Capture proceeds downward toward the initial bottom, not upward into older history.
- Infinite scrolling, lazy loading, animation, and layout changes can affect the result. Load the content first for best results.
- Captures are limited to 100 screens, 32,767 image pixels in height, and 100 million pixels total. Reduce browser zoom for very long pages.
- Avoid switching tabs, resizing the window, or scrolling during capture.

## Development and validation

No build step or runtime dependencies are required. Edit the files and click **Reload** on the extension's `about:debugging` entry.

Run the browser integration check with Node.js, Playwright, and Chromium available:

```sh
node tests/capture.cjs
```

The check uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` to override it. It exercises the capture logic against an actual scrolling page through a browser API adapter, checks output dimensions and colors across stitched sections, and verifies current-position capture, pixel/screen limits, Escape partial saves, download naming, state restoration, nested scrolling panels, and blocked-scroll error handling. It does not replace a Firefox extension API check.

For a manual Firefox check, scroll halfway down a page several screens tall with a fixed header, then start capture. Also test pixel/screen limits and Escape. Verify that the PNG starts at the original position and includes the bottom of the page in end mode, the header appears only once, and your original scroll position is restored. Also try a protected page and confirm that a readable error appears.

Permissions: `activeTab` permits capture and temporary page access after you click the extension; `downloads` saves the resulting PNG. No persistent access to all websites is requested.
