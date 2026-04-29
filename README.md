# Target The Beastie!

A Foundry VTT module for quick token targeting, custom cursors, and multiplayer cursor sharing.

**Version:** 13.3.0  
**Compatibility:** Foundry VTT v13+ (verified on v13.315)  
**Author:** GnollStack

## Features

### Mousewheel Targeting

Target tokens instantly using the middle mouse button instead of switching to the targeting tool.

- **Middle-click** a token to target it
- **Shift + Middle-click** to target multiple tokens
- **Middle-click on empty canvas** clears all of your current targets (toggleable, default on)
- **Shift + Middle-click on empty canvas** keeps your existing targets (no-op)
- Works like pressing the `T` key, but without changing tools

### Marquee Box Select

Hold the middle mouse button and drag to draw a selection rectangle on the canvas. All tokens within the rectangle are targeted when you release.

- **Middle-click + drag** to draw a selection box
- **Shift + drag** to add to your existing targets instead of replacing them
- **Drag over empty space** without Shift to clear all targets
- **Advanced token filters** can limit marquee targeting to hostile, neutral, friendly, or non-friendly tokens
- **GM/co-GM** can target all tokens, including hidden ones
- **Players** can only target tokens visible to them
- Can be toggled independently from single-click targeting in module settings

### Custom Cursors

Replace the default browser cursor with custom cursor images throughout Foundry VTT. Configure different cursors for each interaction state.

| State | When Active |
|-------|-------------|
| Default | Normal cursor on the canvas and UI |
| Hover | Mouse is over a token or a clickable Foundry UI control |
| Click | Mouse button is held on clickable controls |
| Hover To Drag | Mouse is over draggable headers, rows, or drag sources |
| Dragging | A draggable UI element is actively being dragged |
| Resize | Mouse is over a window resize handle |
| Text Editing | Mouse is over a text field or editor |
| Targeting | Targeting tool is active |
| Panning | Right-click dragging to pan |

Per-state customization includes:

- Upload custom cursor images
- Set the click hotspot position
- Rotate the cursor from `0-359` degrees
- Resize the cursor with width and height controls
- Lock aspect ratio while resizing
- Enable or disable individual non-default states
- Preview the cursor live with hotspot visualization
- Fall back to the built-in Age of Myth default cursor
- Performance-safe UI hover handling that avoids inventory and sheet FPS spikes

### Multiplayer Cursor Sharing

See other players' cursors on the canvas in real-time. Each shared cursor appears as either a synced custom cursor image or a colored arrow fallback using the player's Foundry color.

- **Real-time position sharing** via WebSocket at about `30Hz`
- **Smooth interpolation** between received positions for fluid movement
- **Custom cursor images shared** between players
- **Zoom-independent sizing** so cursors keep a consistent screen size at any canvas zoom
- **Shared Cursor Size setting** controls the final on-screen size of remote cursors even when players use different source image sizes
- **Scene-aware** so only cursors from players on the same scene are shown
- **Late-start image requests** so cursor images are refreshed when sharing is enabled after other players are already connected
- **Cursor Sharing Mode** can share your cursor, receive only, or fully hide your cursor from others
- **Per-player visibility controls** let you hide specific shared cursors locally
- **Auto-fade** after `5` seconds of inactivity

### Shared Cursor Name Labels

Position a player name label next to each shared cursor. This is the module's movable overlay label, separate from Foundry's built-in cursor name.

- **Preset or custom** positioning
- **Per-user positioning** synced to other clients
- **Drag-to-place** in the Default tab of the Cursor Settings preview

### Built-In Foundry Cursor Elements

Control Foundry's built-in cursor elements, the colored dot and player name, independently from the module's shared overlay.

| Option | What's Shown |
|--------|--------------|
| Show Player Names & Color Dots | Both Foundry default elements visible |
| Show Only Player Names | Foundry name label visible, color dot hidden |
| Show Only Color Dots | Color dot visible, Foundry name label hidden |
| Hide Both | All Foundry default cursor elements hidden |

This makes it easy to show only the module's movable overlay name without also showing Foundry's built-in name.

When **Show Shared Cursor Names (Overlay)** is enabled, the module automatically hides Foundry's default white cursor name while preserving the native color dot when applicable. This prevents duplicate name labels.

### Idle Identity Fade-In

When the hidden advanced **Show Identity on Idle** setting is enabled and some Foundry elements are hidden, the hidden elements fade in as a player's cursor fades out after going idle.

| Foundry Elements Setting | What Fades In on Idle |
|--------------------------|-----------------------|
| Hide Both | Both name and color dot |
| Show Only Player Names | Color dot |
| Show Only Color Dots | Player name |
| Show Player Names & Color Dots | Nothing |

## Settings

Cursor appearance is saved per Foundry user, so it follows the player instead of the browser. GMs can open **Cursor Settings** and choose a player to edit that player's cursor profile. The remaining module settings are client-scoped viewer preferences or local feature toggles under **Module Settings > Target The Beastie!**

| Setting | Default | Description |
|---------|---------|-------------|
| Middle-Mouse Actions | Click + Drag | Choose Off, Click to Target, Drag Marquee, or Click + Drag. Hold Shift to add to existing targets. |
| Clear Targets on Empty Middle-Click | On | Middle-click on empty canvas clears all current targets. Hold Shift to keep them. |
| Cursor Settings (button) | - | Opens the per-player cursor configuration UI for custom cursor enablement, per-state cursor images, and shared overlay name placement. |
| Shared Cursor Size | 16px | Size at which other players' shared cursors appear on your screen. |
| Show Shared Cursor Names (Overlay) | Off | Display the module's movable overlay name next to remote shared cursors. Foundry's default white name is hidden automatically while this is on. |
| Built-In Foundry Cursor Elements | Show Both | Choose which of Foundry's built-in cursor elements remain visible when module overlay names are off, or which native dot/name elements are available for idle identity behavior. |
| Cursor Sharing Mode | Share My Cursor | Share your module cursor, receive only, or use Private mode to hide your cursor from others, including Foundry's built-in cursor dot/name. |
| Debug Mode | Off | Enable console logging for troubleshooting. |

## Cursor Configuration

Click **Cursor Settings** in the module settings to open the configuration UI.

If you are a GM, choose the player at the top of the window before saving. Connected players automatically apply GM changes to their own cursor profile.

For each cursor state you can:

1. Set an image by typing a path or using the Browse button
2. Restore the built-in AoM default cursor
3. Adjust the hotspot with X and Y sliders
4. Rotate the cursor from `0-359` degrees
5. Resize it with width and height controls
6. Enable or disable non-default states
7. Clear a non-default state's image to use Foundry's native cursor for that state
8. Preview each state's native fallback cursor directly in the config UI
9. In the Default tab, drag the preview label or use the preset buttons to position the module's shared overlay name
10. Reset a profile to defaults or copy a profile from another player

The live preview shows your cursor image with a red dot marking the hotspot position.

The draggable name label in the preview only controls the module's shared overlay name. Foundry's built-in cursor name is configured separately through **Built-In Foundry Cursor Elements**.

## Advanced Settings

Open **Advanced Settings** from the module settings to tune less-common behavior without crowding the main Foundry settings list.

- Adjust shared cursor opacity and fade behavior
- Filter marquee targeting by token disposition
- Hide specific players' shared cursors on your own client
- View and copy diagnostics for troubleshooting

The module also exposes diagnostics in the console:

```js
game.modules.get("target-the-beastie").api.getDebugState()
TargetTheBeastie.getDebugState()
```

## Performance Notes

Earlier versions of the hover system could cause severe FPS drops when sweeping quickly across dense UI, especially actor inventories and item lists.

- **Problem:** the module used a document-wide JavaScript hover detector that reacted to every `mouseover` across the UI and toggled broad hover styling repeatedly.
- **Symptom:** moving the cursor rapidly across item rows, controls, and nested sheet elements could tank FPS far more than the default Foundry cursor.
- **Fix:** token hover is now still driven by Foundry's `hoverToken` hook, but common UI cursor states use CSS selectors and Foundry's native cursor families instead of document-wide JS hover listeners.
- **Important implementation detail:** Foundry writes its `--cursor-*` variables inline on the root element, so the module now restores Foundry's cursor config first and then applies its own cursor-variable overrides inline as well. A stylesheet-only override is not enough.

## Debugging Checks

Set **Debug Mode** in module settings to focus console output:

| Mode | Use For |
|------|---------|
| Cursor CSS & Settings | Cursor settings migration, image load checks, generated cursor CSS |
| State Detection | Token hover, active targeting tool, and panning cursor classes |
| Cursor Sharing | Socket messages, cursor image broadcasts, cursor image requests |
| Marquee Box Select | Middle-click targeting, drag threshold, selected token counts |

Useful browser console checks:

```js
game.settings.get("target-the-beastie", "settings-version")
game.settings.get("target-the-beastie", "middle-mouse-actions")
game.settings.get("target-the-beastie", "cursor-sharing-mode")
game.user.getFlag("target-the-beastie", "cursorConfig")
game.activeTool
document.getElementById("board")?.classList.toString()
```

## Installation

1. Copy the `target-the-beastie` folder into your Foundry VTT modules directory:

```text
<FoundryData>/Data/modules/target-the-beastie/
```

2. Launch Foundry VTT and enable the module in your world's **Module Management**
3. Configure the module under **Module Settings > Target The Beastie!**

## File Structure

```text
target-the-beastie/
  module.json              Module manifest
  assets/
    AOM_cursor_pointer.png     Default cursor image
    AOM_cursor_pointer_32x32.png
  scripts/
    main.js                Entry point - hooks and settings registration
    constants.js           Module constants and debug utility
    settings.js            Default cursor states and settings migration
    advanced-settings-app.js Advanced settings and diagnostics UI
    cursor-styles.js       CSS generation and image processing (rotation/resize)
    cursor-config-app.js   Configuration UI (ApplicationV2 + Handlebars mixin)
    state-detection.js     Detects hover/targeting/panning states
    targeting.js           Single-token targeting logic
    marquee-select.js      Marquee box select and middle-mouse handler
    cursor-overlay.js      PIXI rendering of shared remote cursors
    cursor-sharing.js      Socket communication for cursor position and image sharing
  templates/
    cursor-config.html     Handlebars template for the configuration UI
    advanced-settings.html Handlebars template for advanced settings
```

## Troubleshooting

**Cursors not appearing for other players:**

- Make sure the player whose cursor is missing has **Cursor Sharing Mode** set to **Share My Cursor**
- Make sure that player is not using **Private** mode
- Verify both players are on the same scene
- Switch **Cursor Sharing Mode** back to **Share My Cursor** to rebroadcast that player's cursor image
- Check the browser console (`F12`) for errors
- Set Debug Mode to **Cursor Sharing** to see socket messages

**Custom cursor not displaying:**

- Ensure the image path is valid and the file exists
- Keep cursor images at `128x128` or smaller for best browser compatibility
- Try the built-in default cursor
- If changing cursor code, remember Foundry stores `--cursor-*` values inline on the root element; overriding them only in a stylesheet can leave the native cursor active
- Set Debug Mode to **Cursor CSS & Settings** for detailed logging

**Shared cursor name placement not behaving as expected:**

- Enable **Show Shared Cursor Names (Overlay)** to see the module's movable label
- Foundry's default white cursor name is hidden automatically while the module overlay name is enabled
- Use the Default tab in **Cursor Settings** to drag the overlay name label or choose a preset position

**Middle-mouse targeting not working:**

- Verify **Middle-Mouse Actions** is set to **Click to Target** or **Click + Drag**
- Make sure you're clicking directly on a token
- If you moved the mouse more than the marquee threshold before release, the click is treated as a drag gesture instead of a single-target click
- Some mice and trackpads may not have a middle button

**Marquee box select not working:**

- Verify **Middle-Mouse Actions** is set to **Drag Marquee** or **Click + Drag**
- Make sure you drag at least `10` pixels to trigger the selection rectangle
- Marquee selection can remain enabled even when middle-click targeting is disabled
- Check **Advanced Settings > Marquee Targeting** if a token disposition filter is active
- Players can only target tokens visible to them
- Set Debug Mode to **Marquee Box Select** to see selection details

---

## License & Permissions

### Proprietary EULA
This module is licensed under the **GnollStack Proprietary EULA**.
It is **free for personal use** - you can use it in your home games, stream it, or modify it for your own table without restriction.

**Commercial redistribution is strictly prohibited.**
You may not sell this module, bundle it within paid content (such as Patreon maps or adventures), or host it as a commercial service without prior written consent.

### Commercial Licensing
I am open to partnerships. If you are a map maker, adventure writer, or developer who wishes to use this module commercially, please get in touch. Commercial licenses are available for:
* Bundling with paid VTT content
* Official integration into commercial systems
* Custom feature development

### Contact
For licensing inquiries or permission slips:
* **Discord:** `GnollStack` (Preferred)
* **Email:** `Somedudeed@gmail.com`
* *Please do not open GitHub Issues for commercial licensing discussions. But feel free to contact me via Discord or Email*

Please do not open GitHub issues for commercial licensing discussions.

---
