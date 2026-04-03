# NEON HAND - Air Canvas

A browser-based hand-tracking canvas that lets you draw, grab, erase, and pause using natural hand gestures through a webcam. It uses MediaPipe Hands for real-time landmark tracking and a full-screen canvas pipeline for low-latency interaction.

## Features

- Real-time hand tracking in the browser
- Gesture-based drawing with smoothing and velocity-aware strokes
- Pinch-to-grab with locked grab mode for stable movement
- Palm eraser for quick clearing
- Brush color and size controls
- Minimal dependency setup using CDN-hosted MediaPipe assets
- Responsive HUD and visual feedback for each gesture

## Gestures

- Index finger up: draw
- Pinch gesture: grab and move the drawing
- Open palm: erase
- Fist or no hand detected: idle

## Controls

- `1` - Blue
- `2` - Purple
- `3` - Pink
- `4` - Green
- `C` - Clear the canvas
- `Esc` - Release an active grab

## Project Structure

- `index.html` - App shell, HUD, and MediaPipe script imports
- `style.css` - Visual design, layout, and HUD styling
- `app.js` - Gesture logic, drawing engine, and camera integration

## How It Works

1. The browser requests webcam access.
2. MediaPipe Hands detects the hand landmarks in real time.
3. The app classifies the current gesture.
4. Drawing strokes are smoothed and rendered onto the canvas.
5. Grab mode snapshots the full drawing layer and keeps it locked until you intentionally release it.

## Running Locally

Because the app uses the camera and external script assets, it should be served from a local web server rather than opened directly from the file system.

Example options:

- VS Code Live Server
- `python3 -m http.server`
- Any static hosting service

Then open the local URL in a modern browser and allow camera access.

## Browser Requirements

- A modern Chromium-based browser or Safari with webcam support
- Camera permission enabled
- HTTPS for deployed environments

## Customization

The main behavior can be tuned in `app.js`:

- Drawing smoothing and stroke continuity
- Pinch thresholds for grab activation
- Grab release lock timing
- Brush profile sizes and opacity
- Eraser radius

If you plan to publish this publicly, keep the gesture thresholds conservative enough for different webcams and lighting conditions.

## Troubleshooting

- If the app does not detect your hand, check camera permission and lighting.
- If drawing feels jittery, increase smoothing or reduce large segment jumps.
- If grab is too sensitive, raise the pinch activation threshold or increase the hold frames.
- If the canvas appears blank after a grab, confirm that the hand is still being tracked and that grab release is intentional.

## Notes for Contributors

- Keep gesture state transitions explicit and stable.
- Avoid adding unused libraries or DOM elements.
- Prefer small, testable changes to gesture logic and rendering behavior.

## License

Choose a license before publishing. If you want a public open-source release, add a `LICENSE` file and reference it here.
