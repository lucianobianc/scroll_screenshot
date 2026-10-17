# Scroll Screenshot

A simple Firefox extension that scrolls from your current position and saves the captured portion as one PNG image. Images are processed locally; nothing is uploaded.

## Install in Firefox for development

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select this folder's `manifest.json`.
3. Open a normal web page, click the extension in Firefox's extensions menu, choose a capture mode, then click **Iniciar captura**.
4. Keep the tab visible until the PNG is saved to your Downloads folder. Choose **Até o fim da página**, a height in pixels, or a number of screens. The limit includes the current screen.
5. Press **Esc** on the page (close the popup first if needed), or click **Parar e salvar**, to save only the completed sections. The current frame is always captured before stopping.

Temporary add-ons are removed when Firefox restarts. Distribution requires packaging and Mozilla signing.

## Selected area capture

Check **Selecionar uma área antes de capturar**, choose the desired limit, and click **Iniciar captura**. The popup closes; drag a rectangle on the page and release to start. Escape cancels before selection and stops/saves during capture.

Select entirely inside the scrolling panel you want, excluding the composer, shadows, and other overlays. The rectangle remains fixed on screen. The extension scrolls by its height and stacks only new rows, accounting for the actual final scroll distance. Screen limits refer to the selected rectangle's height. The original scroll position is restored afterward.

This mode assumes static content and layout. It does not compare images or hide website elements automatically. Capture ends when the panel reaches its scrolling limit; content that never passes through the selected rectangle is excluded. Leave the rectangle away from any overlay that would cover it. Selections must be at least 24 × 24 CSS pixels and fit within one panel. Selection inside embedded frames is not supported.

## Behavior and limits

- Starts at the current scroll position and captures toward the initial bottom of the page, or the selected height limit, at the current viewport width. When the document does not scroll, automatically selects the largest visible scrolling panel (for example, Discord messages) and captures only that panel. Screen limits use the panel height. Horizontal overflow and additional panels are not expanded.
- Temporarily hides small external overlays covering the scrolling panel, such as a message composer, without changing layout. Captures overlapping sections and appends only new rows to avoid gaps at joins. Overlay styles are restored afterward.
- Restores your scroll position after capture, including after errors. Fixed and sticky elements appear in the first section and are hidden in later sections to avoid repeated overlays.
- Firefox internal pages, the Mozilla add-ons site, and other protected pages cannot be captured.
- Discord and other apps may virtualize messages or load content while scrolling; these changes can affect the result. Capture proceeds downward toward the initial bottom, not upward into older history.
- Infinite scrolling, lazy loading, animation, and layout changes can affect the result. Load the content first for best results.
- Captured viewport PNGs and crop coordinates are kept in compressed form while scrolling. No full-page canvas is allocated in advance. At the end, one reusable canvas assembles the output; individual frames are decoded one at a time.
- Each output PNG is limited to 32,767 pixels per dimension and 100 million pixels. Larger captures are automatically split into consecutive files (`name-parte-01.png`, `name-parte-02.png`, …), with no lost or repeated rows between files. Small captures still produce a single PNG. Splitting is based on pixel dimensions, not the compressed PNG file size.
- Captures remain limited to 100 capture steps and 256 MiB of stored compressed frames. Reaching either limit saves the available portion with a partial-capture warning. Escape also saves all completed frames, possibly as several files. No zoom reduction is required just because the total capture is too tall for one PNG.
- Rechecks the live content height and accepts small rounding differences at the bottom. If the app adjusts the scroll position during rendering, retries the requested position before reporting a gap.
- If scrolling or a later frame fails, saves completed sections as a partial capture and shows a warning. Failures before any usable frame, encoding failures, and rejected downloads show an error. If a later output part fails, the error lists how many parts were already sent to Downloads; those files remain available.
- The last result remains available when reopening the popup (until the extension restarts or a new capture starts). A temporary notice also appears on the page after completion.
- Avoid switching tabs, resizing the window, or scrolling during capture.

## Development and validation

No build step or runtime dependencies are required. Edit the files and click **Reload** on the extension's `about:debugging` entry.

Run the browser integration check with Node.js, Playwright, and Chromium available:

```sh
node tests/capture.cjs
```

The check uses `/usr/bin/chromium` by default; set `CHROMIUM_PATH` to override it. It exercises the capture logic against an actual scrolling page through a browser API adapter, checks output dimensions and colors across stitched sections, and verifies current-position capture, pixel/screen limits, Escape partial saves, download naming, state restoration, nested scrolling panels, blocked-scroll error handling, and every output row across joins with an overlaid message composer, recovery after a scroll-position jump, and completion when content height changes or bottom metrics differ by one pixel. It also checks a real 34,001-pixel page, numbered output parts, every row across file boundaries, the pixel-count limit, multipart Escape saving, rejected later downloads, and that scrolling allocates no canvas and output assembly reuses exactly one. It does not replace a Firefox extension API check.

For a manual Firefox check, scroll halfway down a page several screens tall with a fixed header, then start capture. Also test pixel/screen limits and Escape. Verify that the PNG starts at the original position and includes the bottom of the page in end mode, the header appears only once, and your original scroll position is restored. Also try a protected page and confirm that a readable error appears.

Permissions: `activeTab` permits capture and temporary page access after you click the extension; `downloads` saves the resulting PNG. No persistent access to all websites is requested.
