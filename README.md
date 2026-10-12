# Stillwater

A cabin window in the rain, built to be left open all day.

**Live:** https://erayyavuz.github.io/stillwater/

## Things to do
- **Wipe** the misted glass by dragging across it. The view racks into focus and the mist slowly creeps back.
- **Breathe** on the glass by holding still on it, then drag to write in the breath.
- **Knock** on the glass and the drops shiver loose and run.
- **Candle** – blow it out (it leaves a curl of smoke) or strike a match. Drafts and your cursor bend the flame.
- **Oil lamp** – turn it up or down.
- **Tea** – take a sip. Move through the steam to stir it.
- **Tape** – plays a slow, generative electric-piano tape with wow and hiss.
- **Latch** – opens the window, so the rain gets loud and the mist clears.
- **Clock** – shows your real time. Hold it to let the day pass; tap it to come back to now.
- **Scroll** – drizzle to downpour. Downpours bring lightning and thunder.

The light follows your real clock (noon, golden hour, dusk, night). Winter months frost the glass and turn the rain to snow.

## How it's made
- The **glass** is a custom shader:
  - Raindrops are simulated on the CPU (they grow, merge, stick-slip down and leave trails) and splatted into a height field with MAX blending. They refract a sharp render of the outside.
  - The condensation lives in a persistent render target that you wipe, breathe on and drops clear. It regrows over time.
- **Outside**: a procedural lake, forest, sky, rain and mist. It's rendered to a target, blurred, and then seen through the glass.
- **Room**: CC0 scanned props and PBR textures from [Poly Haven](https://polyhaven.com), optimised to meshopt + WebP. Real shadows come from the lamp, the candle and the daylight.
- **Sound**: everything is synthesised with WebAudio. The outdoor sound is muffled behind the glass and opens up with the window.

There's no build step. three.js 0.170 loads from a CDN import map.

## Develop
```sh
python3 -m http.server 8765
cd tools && npm i && node win.mjs <outdir>    # drives every interaction headless
```
URL params: `tod` (0 noon to 3 night), `rain` (0–1), `season=winter`, `open=1`, `lamp=0`, `ui=0`.
