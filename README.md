# Stillwater

A quiet lake you can leave open all day. Rain on the water, a crackling fire, summer and winter, noon to night.

**Live:** https://erayyavuz.github.io/stillwater/

- **Move** to part the grass, **click** the water to send ripples, **tap** the fire for sparks, **scroll** to move the light from noon into night.
- **Skip a stone** across the lake. In winter the lake is frozen and the stone slides with that singing *pew*.
- **Sit for a minute** hides everything and guides six slow breaths.
- **Just the lake** (or `H`) hides the controls. They also fade by themselves after a while.

## How it's made

The scenery is a set of ten photographic plates: noon, golden hour, dusk, night and an overcast version, each for summer and winter. All of them come from one art-directed frame relit with an image-edit model, then upscaled 2×. A depth map and a lake mask for each season drive what happens in the browser in real time:

- Water: reflections distort along a ground-plane mapping, so click ripples and rain rings stay in correct perspective. There's also sparkle on the brightest reflections, and ice in winter.
- Depth parallax that follows the cursor. Foreground grass sways in the wind and parts around the pointer.
- Campfire light, mist drifting over the water, and twinkling stars.
- Overlays: procedural flames, embers, smoke, rain streaks, snowflakes with depth-of-field, fireflies and birds.
- Post-processing: bloom, grain and a vignette.
- All sound is synthesised with WebAudio.

There's no build step. three.js 0.170 loads from a CDN import map.

## Develop

```sh
python3 -m http.server 8765
cd tools && npm i && ./shots.sh <outdir> 1440 760 "tod=1" "tod=3&season=winter"
```

URL params: `tod` (0 noon to 3 night), `season` (`summer`/`winter`), `weather` (`clear`/`rain`/`snow`), `ui=0`.
Plate generation scripts live in `tools/gen` and need `FAL_KEY` in the environment.
