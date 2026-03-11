# Target The Beastie!

A Foundry VTT module for quick token targeting, custom cursors, and multiplayer cursor sharing.

**Version:** 13.1.0
**Compatibility:** Foundry VTT v11+ (verified on v13)
**Author:** GnollStack

## Features

### Mousewheel Targeting

Target tokens instantly using the middle mouse button (mousewheel click) instead of switching to the targeting tool.

- **Middle-click** a token to target it
- **Shift + Middle-click** to target multiple tokens
- Works the same as pressing the T key, but faster

### Marquee Box Select

Hold the middle mouse button and drag to draw a selection rectangle on the canvas. All tokens within the rectangle are targeted when you release.

- **Middle-click + drag** to draw a selection box
- **Shift + drag** to add to your existing targets instead of replacing them
- **Drag over empty space** (without Shift) to clear all targets
- **GM/co-GM** can target all tokens, including hidden ones
- **Players** can only target tokens visible to them
- Can be toggled independently from single-click targeting in module settings

### Custom Cursors

Replace the default browser cursor with custom cursor images throughout Foundry VTT. Configure different cursors for each interaction state.

**Cursor States:**

| State | When Active |
|-------|-------------|
| Default | Normal cursor on the canvas and UI |
| Hover | Mouse is over a token |
| Targeting | Targeting tool is active |
| Panning | Right-click dragging to pan |

**Per-State Customization:**

- Upload custom cursor images (PNG recommended)
- Set the click hotspot position (X/Y coordinates)
- Rotate the cursor (0-359 degrees)
- Resize the cursor (width/height with aspect ratio lock)
- Enable/disable individual states
- Live preview with hotspot visualization
- Includes a built-in Age of Myth (AoM) default cursor

### Multiplayer Cursor Sharing

See other players' cursors on the canvas in real-time. Each cursor appears as a colored arrow indicator (using the player's Foundry color) that smoothly follows their mouse movement.

- **Real-time position sharing** via WebSocket at 20Hz
- **Smooth interpolation** between received positions for fluid movement
- **Custom cursor images shared** between players - if a player has a custom cursor configured, other players see it instead of the default arrow
- **Zoom-independent sizing** - cursors maintain a consistent screen size regardless of canvas zoom level
- **Scene-aware** - only shows cursors from players on the same scene
- **Auto-fade** - cursors fade out after 5 seconds of inactivity

### Cursor Name Labels

Position a player name label next to each shared cursor. Choose from preset positions (Bottom Center, Bottom Right, Top Center, Right) or drag the label to a custom position in the Cursor Settings preview.

- **Per-user positioning** - each player's chosen name position is synced to all other clients so the label appears exactly where they configured it
- **Preset or custom** - pick a preset from the config preview buttons, or drag the name label freely for a custom offset

### Foundry Default Cursor Elements

Control Foundry's built-in cursor elements (the colored dot and player name) independently from the module's overlay:

| Option | What's Shown |
|--------|--------------|
| Show Player Names & Color Dots | Both Foundry default elements visible |
| Show Only Player Names | Foundry name label visible, color dot hidden |
| Show Only Color Dots | Color dot visible, Foundry name label hidden |
| Hide Both | All Foundry default cursor elements hidden |

### Idle Identity Fade-In

When **Show Identity on Idle** is enabled and some Foundry elements are hidden, the hidden elements will fade in as a player's cursor fades out after going idle. This lets you see who was where even when a player is AFK.

What fades in depends on what's currently hidden:

| Foundry Elements Setting | What Fades In on Idle |
|--------------------------|-----------------------|
| Hide Both | Both name and color dot |
| Show Only Player Names | Color dot |
| Show Only Color Dots | Player name |
| Show Player Names & Color Dots | Nothing (everything already visible) |

## Settings

All settings are per-client (each player configures their own). Find them under **Module Settings > Target The Beastie!**

| Setting | Default | Description |
|---------|---------|-------------|
| Use Mousewheel for Targeting | On | Enable middle-mouse-button targeting. Hold Shift for multi-target. |
| Use Marquee Box Select | On | Hold middle mouse and drag to select multiple tokens at once. |
| Use Custom Cursor | On | Replace the default cursor with custom images. |
| Cursor Settings (button) | - | Opens the cursor configuration UI for uploading images and adjusting per-state settings. |
| Shared Cursor Size | 32px | Size (16-128px) at which other players' cursors appear on your screen. |
| Shared Cursor Opacity | 1.0 | Opacity (0.1-1.0) of other players' cursors on your screen. |
| Show Module Cursor Names | Off | Display the player's name next to the module's shared cursor overlay. |
| Cursor Name Position | Bottom Center | Where to display the name relative to the cursor. Options: Bottom Center, Bottom Right, Top Center, Right, Custom. |
| Foundry Default Cursor Elements | Show Both | Control which of Foundry's built-in cursor elements are shown. Options: Show Player Names & Color Dots, Show Only Player Names, Show Only Color Dots, Hide Both. |
| Show Identity on Idle | Off | Fade in the hidden Foundry elements when a cursor goes idle. Only applies when some elements are hidden above. |
| Share Cursor with Other Players | On | Enable sending/receiving cursor positions with other connected players. |
| Debug Mode | Off | Enable console logging for troubleshooting. Options: Off, All, Cursor CSS & Settings, State Detection, Config UI & Save, Cursor Sharing, Marquee Box Select. |

## Cursor Configuration

Click **Cursor Settings** in the module settings to open the configuration UI.

**For each cursor state you can:**

1. **Set an image** - Type a path or use the Browse button to open the Foundry file picker
2. **Use the AoM default** - Click "Reset to Default" to use the built-in cursor
3. **Adjust the hotspot** - Use the X/Y sliders to set where the click point is on the cursor image
4. **Rotate** - Use the rotation slider (0-359 degrees)
5. **Resize** - Set width and height. Use the lock button to maintain aspect ratio
6. **Enable/Disable** - Toggle non-default states on or off

The live preview shows your cursor image with a red dot marking the hotspot position.

**Tips:**
- Cursor images should be 128x128 pixels or smaller for best browser compatibility
- PNG format with transparency works best
- The hotspot is the pixel on the image that represents the actual click point

## Installation

1. Copy the `target-the-beastie` folder into your Foundry VTT modules directory:
   ```
   <FoundryData>/Data/modules/target-the-beastie/
   ```
2. Launch Foundry VTT and enable the module in your world's **Module Management** settings
3. Configure the module under **Module Settings > Target The Beastie!**

## File Structure

```
target-the-beastie/
  module.json              Module manifest
  assets/
    AOM_cursor_pointer.png     Default cursor image
    AOM_cursor_pointer_32x32.png
  scripts/
    main.js                Entry point - hooks and settings registration
    constants.js           Module constants and debug utility
    settings.js            Default cursor states and settings migration
    cursor-styles.js       CSS generation and image processing (rotation/resize)
    cursor-config-app.js   Configuration UI (FormApplication)
    state-detection.js     Detects hover/targeting/panning states
    targeting.js           Single-token targeting logic
    marquee-select.js      Marquee box select and middle-mouse handler
    cursor-overlay.js      PIXI rendering of shared remote cursors
    cursor-sharing.js      Socket communication for cursor position/image sharing
  templates/
    cursor-config.html     Handlebars template for the configuration UI
```

## Troubleshooting

**Cursors not appearing for other players:**
- Make sure both players have **Share Cursor with Other Players** enabled in module settings
- Verify both players are on the same scene
- Check the browser console (F12) for errors
- Set Debug Mode to "Cursor Sharing" to see socket messages in the console

**Custom cursor not displaying:**
- Ensure the image path is valid and the file exists
- Check that the image is 128x128px or smaller
- Try the "Reset to Default" button to use the built-in cursor
- Set Debug Mode to "Cursor CSS & Settings" for detailed logging

**Middle-mouse targeting not working:**
- Verify **Use Mousewheel for Targeting** is enabled
- Make sure you're clicking directly on a token
- Some mice/trackpads may not have a middle button - check your device settings

**Marquee box select not working:**
- Verify both **Use Mousewheel for Targeting** and **Use Marquee Box Select** are enabled
- Make sure you drag far enough (at least 10 pixels) to trigger the selection rectangle
- As a player, you can only target tokens visible to you - hidden tokens will be skipped
- Set Debug Mode to "Marquee Box Select" to see selection details in the console

## License

MIT
