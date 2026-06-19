<div align="center">

# Show of Hands

**A simple module for targeting faster, drawing marquee selections, and making every cursor at the table feel intentional and immerisve.**

[![Latest Release](https://img.shields.io/github/v/release/GnollStack/Target-The-Beastie?label=Latest%20Release&style=flat-square)](https://github.com/GnollStack/Target-The-Beastie/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/GnollStack/Target-The-Beastie/total?style=flat-square&color=green)](https://github.com/GnollStack/Target-The-Beastie/releases)
[![Downloads@latest](https://img.shields.io/github/downloads/GnollStack/Target-The-Beastie/latest/total?style=flat-square)](https://github.com/GnollStack/Target-The-Beastie/releases/latest)
[![Foundry VTT](https://img.shields.io/badge/Foundry-v14%2B-orange?style=flat-square)](https://foundryvtt.com)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Buy%20a%20Steak-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white)](https://ko-fi.com/gnollstack)

*Who doesnt want customized cursors!?*

[Features](#what-you-get) - [Quick Start](#quick-start) - [Preview](#preview) - [Installation](#installation) - [Use It For](#use-it-for) - [Compatibility](#compatibility) - [API](#developer-api) - [Community](#community) - [Contributing](#contributing) - [AI Use](#ai-assisted-development) - [Support](#support-development) - [License](#license-permissions)

</div>

---

## Feature Index

| Feature | Why it matters |
| --- | --- |
| **[Middle-Mouse Targeting](#middle-mouse-targeting)** | Target tokens instantly without switching canvas tools. |
| **[Marquee Box Select](#marquee-box-select)** | Drag a rectangle to target groups quickly, with optional filters. |
| **[Custom Cursors](#custom-cursors)** | Give Foundry per-state cursor art, hotspot control, and live previews. |
| **[Multiplayer Cursor Sharing](#multiplayer-cursor-sharing)** | See where other players are pointing without relying on the default cursor dot alone. |
| **[Cursor Name Labels](#shared-cursor-name-labels)** | Place clean, movable player labels next to shared cursors. |

> Foundry already has targeting and cursor presence. Show of Hands makes those actions faster, more visible, and easier to customize for the way your table actually plays.

---

<a id="quick-start"></a>

## Quick Start

1. Install and enable **Show of Hands** in your world.
2. Open **Configure Settings > Module Settings > Show of Hands**.
3. Set **Middle-Mouse Actions** to **Click + Drag** for both single-token targeting and marquee selection.
4. Open **Cursor Settings** to choose cursor images, hotspots, cursor sizes, and shared overlay name placement.
5. Set **Cursor Sharing Mode** to decide whether you share your cursor, receive only, or stay private.

---

<a id="preview"></a>

## Preview

<img width="1608" height="660" alt="Convert to GIF project - June 18, 2026 at 19 09 25" src="https://github.com/user-attachments/assets/6943fa8f-f1d9-4b20-892e-033ff85263d8" />

---

<a id="what-you-get"></a>

## What You Get

### Middle-Mouse Targeting

**Target tokens with the mousewheel button instead of swapping to the targeting tool.**

- **Middle-click** a token to target it.
- **Shift + Middle-click** a token to add it to your existing targets.
- **Middle-click empty canvas** to clear your current targets when that setting is enabled.
- **Shift + Middle-click empty canvas** keeps existing targets.
- Uses the same practical behavior as pressing `T`, but without interrupting your active tool.

### Marquee Box Select

**Hold the middle mouse button and drag to target multiple tokens at once.**

- **Middle-click + drag** draws a selection rectangle on the canvas.
- **Shift + drag** adds selected tokens to your current targets.
- Dragging over empty space without Shift clears targets.
- Optional token filters can limit marquee selection to hostile, neutral, friendly, or non-friendly tokens.
- Optional level filtering can limit marquee targeting to the currently viewed Scene Level when Foundry exposes one.
- GMs and co-GMs can target all tokens, including hidden ones.
- Players can only target tokens visible to them.

<img width="1027" height="863" alt="image" src="https://github.com/user-attachments/assets/e34e38d2-e63d-4f7d-8986-0088b273d17e" />

<details>
<summary><strong>Marquee targeting details</strong></summary>

- Drag threshold is `10` pixels before the gesture becomes a marquee selection.
- Single-click targeting and drag marquee targeting are controlled together by **Middle-Mouse Actions**: Off, Click to Target, Drag Marquee, or Click + Drag.
- Marquee filters live in **Advanced Settings** to keep the normal settings list compact.
- Scene Level filtering is only used when the runtime exposes level context and **Advanced Settings > Marquee Targeting > Level Filter** is set to **Viewed Level Only**.

</details>

### Custom Cursors

**Replace Foundry's default browser cursor with configurable per-state cursor images.**

| State | When Active |
| --- | --- |
| Default | Normal cursor on the canvas and UI. |
| Hover | Mouse is over a token or clickable Foundry UI control. |
| Click | Mouse button is held on clickable controls. |
| Hover To Drag | Mouse is over draggable headers, rows, or drag sources. |
| Dragging | A draggable UI element is actively being dragged. |
| Resize | Mouse is over a window resize handle. |
| Text Editing | Mouse is over a text field or editor. |
| Targeting | Targeting tool is active. |
| Panning | Right-click dragging to pan. |

Per-state customization includes FilePicker-backed image paths, click hotspot position, rotation from `0-359` degrees, width and height controls, aspect-ratio locking, state enablement, live preview, native fallback previews, and profile copy/reset controls. Show of Hands ships without cursor artwork; leave an image path empty to use Foundry's native cursor for that state.

<img width="947" height="896" alt="image" src="https://github.com/user-attachments/assets/b6577dfe-5a2f-4dcf-a65e-754ac434ddbe" />

<details>
<summary><strong>Cursor configuration details</strong></summary>

Click **Cursor Settings** in module settings to open the configuration UI. GMs can choose a player at the top of the window before saving; connected players automatically apply GM changes to their own cursor profile.

For each cursor state you can:

1. Set an image by typing a path or using the Browse button to choose a file available to Foundry.
2. Clear the image path to use Foundry's native cursor for that state.
3. Adjust the hotspot with X and Y sliders.
4. Rotate the cursor from `0-359` degrees.
5. Resize it with width and height controls.
6. Enable or disable non-default states.
7. Clear any state's image to use Foundry's native cursor for that state.
8. Preview each state's native fallback cursor directly in the config UI.
9. In the Default tab, drag the preview label or use preset buttons to position the module's shared overlay name.
10. Reset a profile to defaults or copy a profile from another player.

The live preview shows the cursor image with a red dot marking the hotspot. The draggable name label controls only the module's shared overlay name; Foundry's built-in cursor name is configured separately through **Built-In Foundry Cursor Elements**. Players can use their own cursor image files anywhere Foundry's FilePicker can read them.

</details>

### Multiplayer Cursor Sharing

**Show other players' cursors on the canvas in real time.**

Each shared cursor appears as either the player's synced custom cursor image or a colored arrow fallback using that player's Foundry color.

- Position sharing runs through the module socket at about `30Hz`.
- Smooth interpolation keeps remote cursor motion readable.
- Custom cursor images are shared between players.
- Cursor size stays zoom-independent at any canvas zoom.
- **Shared Cursor Size** controls the final on-screen size for remote cursors.
- Scene awareness shows only cursors from players on the same scene.
- Late-start image requests refresh cursor images when sharing is enabled after other players are already connected.
- **Cursor Sharing Mode** can share your cursor, receive only, or fully hide your cursor from others.
- Sharing respects Foundry's core **Display Mouse Cursor** permission.
- Per-player visibility controls can hide specific shared cursors locally.
- Shared cursors auto-fade after `5` seconds of inactivity unless fade is disabled in advanced settings.

<details>
<summary><strong>Privacy and visibility details</strong></summary>

**Cursor Sharing Mode** has three options:

| Mode | Behavior |
| --- | --- |
| Share My Cursor | Send your module cursor and receive others. |
| Receive Only | Hide your cursor from others while still seeing shared cursors locally. |
| Private | Hide your cursor from others, including Foundry's built-in cursor dot and name. |

Private mode also wraps native cursor activity so canvas pings do not reveal your cursor through Foundry's built-in cursor display.

</details>

### Shared Cursor Name Labels

**Place a clean player name label next to each shared cursor.**

The module overlay label is separate from Foundry's built-in cursor name. You can use preset positions or drag the label into a custom position in the Default tab of the Cursor Settings preview. Per-user positioning is synced to other clients.

When **Show Shared Cursor Names (Overlay)** is enabled, the module automatically hides Foundry's default white cursor name while preserving the native color dot when applicable. This prevents duplicate name labels.

### Built-In Foundry Cursor Elements

**Control Foundry's native cursor dot and name independently from the module overlay.**

| Option | What's Shown |
| --- | --- |
| Show Player Names & Color Dots | Both Foundry default elements visible. |
| Show Only Player Names | Foundry name label visible, color dot hidden. |
| Show Only Color Dots | Color dot visible, Foundry name label hidden. |
| Hide Both | All Foundry default cursor elements hidden. |

<details>
<summary><strong>Idle identity fade-in</strong></summary>

When the hidden advanced **Show Identity on Idle** setting is enabled and some Foundry elements are hidden, those hidden elements fade in as a player's cursor fades out after going idle.

| Foundry Elements Setting | What Fades In on Idle |
| --- | --- |
| Hide Both | Both name and color dot. |
| Show Only Player Names | Color dot. |
| Show Only Color Dots | Player name. |
| Show Player Names & Color Dots | Nothing. |

</details>

<details>
<summary><strong>Advanced settings and diagnostics</strong></summary>

Open **Advanced Settings** from module settings to tune less-common behavior without crowding the main Foundry settings list.

- Adjust shared cursor opacity and fade behavior.
- Filter marquee targeting by token disposition.
- Filter marquee targeting to the current viewed Scene Level when scene level context is available.
- Hide specific players' shared cursors on your own client.
- View and copy diagnostics for troubleshooting.

The module exposes a compact support snapshot in the console:

```javascript
game.modules.get("show-of-hands").api.getDebugState()
ShowOfHands.getDebugState()
```

For MCP Diagnostics through Foundry MCP Bridge, enable **Debug Mode** as a GM and turn on **Enable MCP Diagnostics**. These controls are advanced GM-only troubleshooting tools and can stay disabled during normal play.

```javascript
game.modules.get("show-of-hands").api.diagnostics.actions.getStatus()
game.modules.get("show-of-hands").api.diagnostics.actions.validateSettings()
game.modules.get("show-of-hands").api.diagnostics.actions.validateAssets()
game.modules.get("show-of-hands").api.diagnostics.actions.validateV14Runtime()
game.modules.get("show-of-hands").api.diagnostics.actions.collectClientDiagnostics()
game.modules.get("show-of-hands").api.diagnostics.actions.validateCursorConfig()
game.modules.get("show-of-hands").api.diagnostics.actions.validateCursorAssets()
game.modules.get("show-of-hands").api.diagnostics.actions.runSmokeTests()
game.modules.get("show-of-hands").api.diagnostics.actions.refreshClient({ delayMs: 250 })
```

The normal hard refresh path from MCP is the bridge-level `reload-foundry-client` tool. The module-level `refreshClient({ delayMs })` action is also available so this module's own diagnostics gate can be tested.

`validateV14Runtime()` is read-only and checks the V14 ApplicationV2, DialogV2, cursor, FilePicker, FormDataExtended, and canvas cursor contracts used by the module. It also reports Scene Levels observations when Foundry exposes them.

A diagnostic warning that legacy `cursor-states` differs from `flags.show-of-hands.cursorConfig` is expected after per-user profiles exist. The user flag profile is canonical. Legacy profiles from `flags.target-the-beastie.cursorConfig` are read and migrated for compatibility.

Mutating fixture checks are paired with **Enable MCP Diagnostics** and still require an explicit `confirmMutation: true` argument:

```javascript
game.modules.get("show-of-hands").api.diagnostics.actions.runAutomation({ confirmMutation: true })
game.modules.get("show-of-hands").api.diagnostics.actions.cleanupFixtures({ confirmMutation: true })
```

Automation creates temporary active-scene token fixtures named with the `SOH-MCP-FIXTURE` prefix and flagged with `flags.show-of-hands.mcpAutomationFixture`. Cleanup recognizes old `TTB-MCP-FIXTURE` fixtures for compatibility, but new automation uses the Show of Hands prefix. Keep MCP diagnostics disabled during normal play and use automation only in dedicated test worlds.

</details>

<details>
<summary><strong>Performance notes</strong></summary>

Earlier versions of the hover system could cause severe FPS drops when sweeping quickly across dense UI, especially actor inventories and item lists.

- **Problem:** the module used a document-wide JavaScript hover detector that reacted to every `mouseover` across the UI and toggled broad hover styling repeatedly.
- **Symptom:** moving the cursor rapidly across item rows, controls, and nested sheet elements could tank FPS far more than the default Foundry cursor.
- **Fix:** token hover is now still driven by Foundry's `hoverToken` hook, but common UI cursor states use CSS selectors and Foundry's native cursor families instead of document-wide JavaScript hover listeners.
- **Important implementation detail:** Foundry writes its `--cursor-*` variables inline on the root element, so the module restores Foundry's cursor config first and then applies its own cursor-variable overrides inline as well. A stylesheet-only override is not enough.

</details>

<details>
<summary><strong>Troubleshooting checks</strong></summary>

**Cursors not appearing for other players:**

- Make sure the player whose cursor is missing has **Cursor Sharing Mode** set to **Share My Cursor**.
- Make sure Foundry's **Display Mouse Cursor** permission is enabled for that player role.
- Make sure that player is not using **Private** mode.
- Verify both players are on the same scene.
- Switch **Cursor Sharing Mode** back to **Share My Cursor** to rebroadcast that player's cursor image.
- Check the browser console (`F12`) for errors.
- Set Debug Mode to **Cursor Sharing** to see socket messages.

**Custom cursor not displaying:**

- Ensure the image path is valid and the file exists.
- Keep cursor images at `128x128` or smaller for best browser compatibility.
- Clear the image path to confirm the native cursor fallback, then choose a known-good image file through Browse.
- If changing cursor code, remember Foundry stores `--cursor-*` values inline on the root element; overriding them only in a stylesheet can leave the native cursor active.
- Set Debug Mode to **Cursor CSS & Settings** for detailed logging.

**Shared cursor name placement not behaving as expected:**

- Enable **Show Shared Cursor Names (Overlay)** to see the module's movable label.
- Foundry's default white cursor name is hidden automatically while the module overlay name is enabled.
- Use the Default tab in **Cursor Settings** to drag the overlay name label or choose a preset position.

**Middle-mouse targeting not working:**

- Verify **Middle-Mouse Actions** is set to **Click to Target** or **Click + Drag**.
- Make sure you're clicking directly on a token.
- If you moved the mouse more than the marquee threshold before release, the click is treated as a drag gesture instead of a single-target click.
- Some mice and trackpads may not have a middle button.

**Marquee box select not working:**

- Verify **Middle-Mouse Actions** is set to **Drag Marquee** or **Click + Drag**.
- Make sure you drag at least `10` pixels to trigger the selection rectangle.
- Marquee selection can remain enabled even when middle-click targeting is disabled.
- Check **Advanced Settings > Marquee Targeting** if a token disposition or level filter is active.
- Players can only target tokens visible to them.
- Set Debug Mode to **Marquee Box Select** to see selection details.

Set **Debug Mode** in module settings to focus console output:

| Mode | Use For |
| --- | --- |
| Cursor CSS & Settings | Cursor settings migration, image load checks, generated cursor CSS. |
| State Detection | Token hover, active targeting tool, and panning cursor classes. |
| Cursor Sharing | Socket messages, cursor image broadcasts, cursor image requests. |
| Marquee Box Select | Middle-click targeting, drag threshold, selected token counts. |

Useful browser console checks:

```javascript
game.settings.get("show-of-hands", "settings-version")
game.settings.get("show-of-hands", "middle-mouse-actions")
game.settings.get("show-of-hands", "cursor-sharing-mode")
game.user.getFlag("show-of-hands", "cursorConfig")
game.activeTool
document.getElementById("board")?.classList.toString()
```

</details>

---

<a id="installation"></a>

## Installation

1. Foundry -> **Add-on Modules** -> **Install Module**.
2. Search for "Show of Hands", or paste this manifest URL:

```text
https://github.com/GnollStack/Target-The-Beastie/releases/latest/download/module.json
```

3. Enable the module in your world.
4. Configure it under **Module Settings > Show of Hands**.

| Requirement | Version |
| --- | --- |
| Foundry VTT | v14+ (verified on v14.363) |

---

<a id="use-it-for"></a>

## Use It For

| Use case | What it looks like |
| --- | --- |
| **Fast combat targeting** | Middle-click enemies without changing canvas tools. |
| **Area targeting** | Drag a marquee over a cluster of visible tokens and target the whole group at once. |
| **Table presence** | Show player cursors with readable, movable name labels. |
| **Cursor theming** | Give the whole Foundry UI custom cursor art for hover, drag, targeting, panning, and text states. |
| **Privacy** | Receive other cursors while hiding your own, or go fully private when needed. |

<details>
<summary><strong>Recipe - quick group target</strong></summary>

1. Set **Middle-Mouse Actions** to **Click + Drag**.
2. Hold the middle mouse button on the canvas.
3. Drag across the tokens you want to target.
4. Release to replace your current targets, or hold Shift while dragging to add to them.

</details>

<details>
<summary><strong>Recipe - clean shared cursor labels</strong></summary>

1. Enable **Show Shared Cursor Names (Overlay)**.
2. Open **Cursor Settings**.
3. Use the Default tab preview to drag the overlay label or choose a preset.
4. Set **Built-In Foundry Cursor Elements** to show only the native color dot, or hide both native elements.

</details>

---

<a id="compatibility"></a>

## Compatibility

**Module version:** `14.1.0`

**Foundry VTT:** v14+, verified on v14.363.

**Systems:** System-agnostic. Targeting, cursor styling, and cursor sharing operate at the canvas and client UI layers.

**Browsers:** Cursor customization relies on browser cursor image support. Keep cursor images at `128x128` or smaller for best compatibility.

> [!TIP]
> Show of Hands is intended to be lightweight and client-friendly. The current hover system avoids document-wide JavaScript hover listeners for common UI states and leans on CSS selectors plus Foundry's native cursor families.

<details>
<summary><strong>Scene Levels notes</strong></summary>

The optional viewed-level marquee filter only activates when Foundry exposes scene level observations. If no level context is available, marquee targeting continues to operate on visible tokens normally.

</details>

<details>
<summary><strong>Foundry cursor permission notes</strong></summary>

Cursor sharing respects Foundry's core **Display Mouse Cursor** permission. If that permission blocks a player role, the module will not force that player's cursor to appear through the normal sharing path.

</details>

---

<a id="developer-api"></a>

## Developer API

Access:

```javascript
const api = game.modules.get("show-of-hands").api;
```

Show of Hands' public API is intentionally small and support-oriented.

<details>
<summary><strong>Support state and cursor utilities</strong></summary>

```javascript
api.getDebugState()
api.refreshSharedCursorImage()
api.syncHiddenRemoteCursors()
```

`getDebugState()` also exists on the global helper:

```javascript
ShowOfHands.getDebugState()
TargetTheBeastie.getDebugState() // legacy alias
```

</details>

<details>
<summary><strong>Diagnostics actions</strong></summary>

```javascript
api.diagnostics.actions.getStatus()
api.diagnostics.actions.validateSettings()
api.diagnostics.actions.validateAssets()
api.diagnostics.actions.validateV14Runtime()
api.diagnostics.actions.collectClientDiagnostics()
api.diagnostics.actions.runSmokeTests()
api.diagnostics.actions.validateCursorConfig()
api.diagnostics.actions.validateCursorAssets()
api.diagnostics.actions.openWindow({ window: "cursor" })
api.diagnostics.actions.refreshClient({ delayMs: 250 })
```

Read-only diagnostics are gated behind GM-only debug settings. Mutating fixture automation additionally requires `confirmMutation: true`:

```javascript
api.diagnostics.actions.runAutomation({ confirmMutation: true })
api.diagnostics.actions.cleanupFixtures({ confirmMutation: true })
```

</details>

### Example macros

**Copy a compact debug snapshot to the console.**

```javascript
console.log(game.modules.get("show-of-hands").api.getDebugState());
```

**Refresh the shared cursor image after changing a cursor asset.**

```javascript
game.modules.get("show-of-hands").api.refreshSharedCursorImage();
```

**Open the cursor configuration window through diagnostics.** Requires the diagnostics gates to be enabled.

```javascript
game.modules.get("show-of-hands").api.diagnostics.actions.openWindow({ window: "cursor" });
```

---

<a id="community"></a>

## Community

- **Report bugs** - [open an issue](https://github.com/GnollStack/Target-The-Beastie/issues) with your Foundry version, module version, steps to reproduce, console logs, and screenshots or short clips when useful.
- **Request features** - tell me what happened at your table and what you wish the module could do.
- **Star the repo** - if the module is useful at your table, a star helps other GMs find it.
- **Watch releases** - follow the repo for updates, compatibility notes, and new feature releases.

---

<a id="contributing"></a>

## Contributing

Bug reports, feature ideas, reproduction notes, documentation fixes, and localization ideas are welcome.

I am not generally accepting unsolicited code PRs for features, refactors, architecture, or behavior changes. This is still my module and my codebase; I will decide how features are designed and implemented unless I explicitly say otherwise.

- **Bug reports** - include Foundry version, module version, a console log, and the steps to reproduce. Screenshots or short clips help a lot.
- **Feature requests** - tell me what happened at your table and what you wish the module could do.
- **Pull requests** - please do not open code PRs unless I ask for one. Open an issue with the idea instead.
- **Code ownership** - core implementation, architecture, and release decisions remain with GnollStack unless stated otherwise.
- **Translations and docs** - typo fixes, wording suggestions, and localization ideas are welcome by issue first. I do not have a public translation setup yet, so I will fold useful wording in myself.

Submitted ideas may be adapted, declined, or implemented by GnollStack. Any accepted contribution or submitted project material may be released under the same EULA as the rest of the module.

---

<a id="ai-assisted-development"></a>

## AI-Assisted Development

This module is developed and maintained with the help of AI-assisted tools for coding, debugging, documentation, and testing.

I care about the quality, behavior, performance, security, and long-term maintainability of this module, and I take full responsibility for what ships. AI assistance does not replace review, testing, debugging, or security and design judgment.

AI is used here as a tool under my direction to make Foundry better and allow for long term mod support while still having a life outside of building and maintaining my free and premium modules.

If you are uncomfortable using software developed with AI-assisted tools, this module is not for you.

---

<a id="support-development"></a>

## Support Development

This module represents many hours of development.

If this module made your table smoother, clearer, or just a little more stylish, consider supporting development:

[Buy Me a Steak on Ko-fi](https://ko-fi.com/gnollstack)

> "Thanks for the support! It helps me maintain support for the module and puts a nice steak on the table."

---

<a id="license-permissions"></a>

## License & Permissions

### Proprietary EULA

This module is licensed under the **GnollStack Proprietary EULA**.
It is **Free for Personal Use**, meaning you can use it in your home games, stream it, or modify it for your own table without restriction.

However, **Commercial Redistribution is Strictly Prohibited.**
You may **NOT** sell this module, bundle it within paid content such as Patreon maps or adventures, or host it as a commercial service without prior written consent.

### Commercial Licensing

I am open to partnerships. If you are a map maker, adventure writer, or developer who wishes to use this module commercially, please contact me. Commercial licenses are available for:

- Bundling this module with paid VTT content.
- Official integration into commercial systems.
- Custom feature development for your specific product.

### Contact

For licensing inquiries or permission slips:

- **Discord:** `GnollStack` (Preferred)
- **Email:** `Somedudeed@gmail.com`
- *Please do not open GitHub Issues for commercial licensing discussions. But feel free to contact me via Discord or Email.*

---

<div align="center">

**Author:** [GnollStack](https://github.com/GnollStack) - **Compatibility:** Foundry VTT v14+ - **Version:** 14.0.2

[Back to Top](#show-of-hands)

</div>
