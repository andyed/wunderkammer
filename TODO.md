# TODO

- **Horizontal scroll pans the wall at an angle in the 3D hallway.** Noted by
  Andy, 2026-10-18. Both hallways, the comparison page's walls
  (`wall/comparison-scene.mjs`) and the wall page's aisle
  (`wall/aisle-view.mjs`), use three.js `OrbitControls`, which reads only the
  wheel's vertical delta: vertical scroll zooms and horizontal scroll does
  nothing. A horizontal wheel or trackpad scroll should instead move the
  camera along the wall, at an angle to it.
