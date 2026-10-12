# Stillwater

A quiet lake you can leave open all day. Rain on the water, a crackling fire, summer and winter, noon to night.

**Live:** https://erayyavuz.github.io/stillwater/

- **Move** to part the reeds, **click** the water to send ripples, **tap** the fire for sparks, **scroll** to move the light from noon into night.
- **Skip a stone** across the lake. In winter the lake freezes and the stone slides across the ice with that singing *pew*.
- **Sit for a minute** hides everything and guides six slow breaths.
- **Just the lake** (or `H`) hides the controls. The UI also fades by itself after a short while.

Everything is generated in code: terrain, forest, water, fire, weather and all of the sound (WebAudio synthesis, nothing sampled). There's no build step. It uses three.js 0.170 from a CDN import map.

## Develop

```sh
python3 -m http.server 8765
# headless screenshots: cd tools && npm i && ./shots.sh <outdir> 1200 750 "tod=1" "tod=3&season=winter"
```

URL params for testing: `tod` (0 noon to 3 night), `season` (`summer`/`winter`), `weather` (`clear`/`rain`/`snow`), `ui=0`, `cam=x,y,z,tx,ty,tz`.
