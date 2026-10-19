/** An artwork aisle over the wall's already-evaluated scope. No filter or pile ownership. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AlbumWalls } from './album-walls.mjs';
import { listenSideScroll } from './aisle-wheel.mjs';
import { groupBy } from './layout.mjs';
import { clipKey, matchesFacet } from './context-clusters.mjs';
import { sortClips, attributeMark } from './attributes.mjs';
import { NEUTRAL_NOUNS, wallLabel } from './nouns.mjs';

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const vector = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e6);
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };

export class AisleView {
  constructor(host, callbacks = {}) {
    this.host = host; this.callbacks = callbacks; this.visible = true; this.built = false;
    this.travel = 0; this.spread = .65; this.fitted = true; this.selection = null; this.nouns = NEUTRAL_NOUNS;
    this.clipsByKey = new Map(); this.cohorts = []; this.labels = []; this.listeners = [];
    this.host.classList.add('aisle-host'); this.host.replaceChildren();
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#050510');
    this.camera = new THREE.PerspectiveCamera(42, 1, .05, 2000);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.status = element('p', 'aisle-status'); this.status.setAttribute('role', 'status');
    this.overlay = element('div', 'aisle-labels'); this.overlay.setAttribute('aria-hidden', 'true');
    this.toolbar = element('div', 'aisle-toolbar'); this.toolbar.setAttribute('aria-label', 'Aisle navigation');
    const travelLabel = element('label', 'aisle-travel', 'Walk aisle');
    this.slider = element('input'); this.slider.type = 'range'; this.slider.min = '0'; this.slider.max = '1'; this.slider.step = '.001'; this.slider.value = '0';
    this.slider.setAttribute('aria-label', 'Walk aisle'); travelLabel.append(this.slider);
    const selectLabel = element('label', 'aisle-items', 'Item');
    this.itemSelect = element('select'); this.itemSelect.setAttribute('aria-label', 'Choose an item in this scope'); selectLabel.append(this.itemSelect);
    this.inspectButton = element('button', '', 'Inspect'); this.inspectButton.type = 'button'; this.inspectButton.disabled = true;
    this.toolbar.append(travelLabel, selectLabel, this.inspectButton);
    this.help = element('p', 'aisle-help', 'Drag to look · Scroll to zoom, sideways to walk · Arrows turn · Home: entrance');
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.canvas = this.renderer.domElement; this.canvas.className = 'aisle-canvas'; this.canvas.tabIndex = 0;
      this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', 'Artwork aisle. Drag or use arrow keys to turn, plus and minus to zoom, scroll sideways to walk, Home for entrance. Tab to choose and inspect any item.');
      this.host.append(this.canvas);
      // Sideways scroll is a walk along the aisle; vertical scroll stays OrbitControls' zoom.
      this.unlistenWheel = listenSideScroll(this.canvas, { walk: distance => this.walk(distance) });
      this.controls = new OrbitControls(this.camera, this.canvas); this.controls.enableDamping = false;
      this.controls.enablePan = false; this.controls.minDistance = .5; this.controls.maxDistance = 80;
      this.controls.minPolarAngle = .15; this.controls.maxPolarAngle = Math.PI * .9;
      this.controls.rotateSpeed = .55; this.controls.zoomSpeed = .65;
      this.controls.addEventListener('change', () => { this.invalidate(); if (!this.programmatic) { this.fitted = false; this.cancelHover(); this.interact(); } });
      // The nouns arrive with setClips, after this; the label reads them when each rack is built.
      this.art = new AlbumWalls(this.root, () => this.invalidate(), { onProgress: () => this.updateStatus(), wallLabel: (label, count) => wallLabel(label, count, this.nouns) });
      this.raycaster = new THREE.Raycaster();
      this.listen(this.canvas, 'pointerdown', e => { this.cancelHover(); this.down = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null; });
      this.listen(this.canvas, 'pointerup', e => {
        if (this.down?.id === e.pointerId && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) {
          const hit = this.pick(e); if (hit) this.open(hit.key);
        }
        this.down = null;
      });
      this.listen(this.canvas, 'pointermove', e => {
        if (e.buttons || e.pointerType === 'touch') return;
        const hit = this.pick(e); this.canvas.style.cursor = hit ? 'pointer' : 'grab';
        if (hit?.key !== this.hoverKey) {
          this.cancelHover();
          if (hit && (this.callbacks.hoverEnabled?.() ?? true)) { this.hoverKey = hit.key; this.callbacks.onHover?.(this.clipsByKey.get(hit.key), e); }
        }
      });
      this.listen(this.canvas, 'pointerleave', () => { this.down = null; this.cancelHover(); });
      this.listen(this.canvas, 'pointercancel', () => { this.down = null; this.cancelHover(); });
      this.listen(this.canvas, 'keydown', e => this.keydown(e));
      this.listen(this.canvas, 'webglcontextlost', e => { e.preventDefault(); this.contextLost = true; this.host.dataset.graphicsState = 'lost'; this.updateStatus(); });
      this.listen(this.canvas, 'webglcontextrestored', () => { this.contextLost = false; this.host.dataset.graphicsState = 'ready'; this.updateStatus(); this.invalidate(); });
      this.host.dataset.graphicsState = 'ready';
    } catch (error) { this.contextLost = true; this.host.dataset.graphicsState = 'unavailable'; this.graphicsError = error.message; }
    this.host.append(this.overlay, this.status, this.toolbar, this.help);
    this.listen(this.slider, 'input', () => { this.travel = Number(this.slider.value); this.fitted = true; this.applyPose(); this.cancelHover(); this.interact(); });
    this.listen(this.itemSelect, 'change', () => this.choose(this.itemSelect.value));
    this.listen(this.itemSelect, 'keydown', e => { if (e.key === 'Enter' && this.selection) { e.preventDefault(); this.open(this.selection); } });
    this.listen(this.inspectButton, 'click', () => { if (this.selection) this.open(this.selection); });
    // Debug handle, as in the floating space (window.__cwFloat): the camera,
    // spread and travel live in WebGL, so probes and seeked captures reach them here.
    window.__cwAisle = this;
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize();
  }

  listen(node, name, fn) { node.addEventListener(name, fn); this.listeners.push([node, name, fn]); }
  interact() { if (!this.programmatic && !this.disposed) this.callbacks.onInteraction?.(); }

  setClips(filtered, groupKey, { sort = { key: 'none', direction: 'asc' }, labelFor, nouns = NEUTRAL_NOUNS } = {}) {
    this.nouns = nouns;
    const sorted = sortClips(filtered, sort);
    this.clipsByKey = new Map(sorted.map(clip => [clipKey(clip), clip]));
    this.cohorts = groupBy(sorted, groupKey).filter(group => group.clips.length).map((group, i) => ({
      key: group.label || '__all__', label: group.label ? (labelFor?.(group.label) || group.label) : `All ${nouns.items}`,
      keys: [...new Set(group.clips.map(clipKey))], count: new Set(group.clips.map(clipKey)).size, unit: nouns.items,
    }));
    this.art?.setModel({ cohorts: this.cohorts, clipsByKey: this.clipsByKey, allRows: [] }, { preserveOrder: true });
    this.art?.setPresentation({ spread: this.spread, slice: null });
    this.camera.far = Math.max(2000, (this.art?.totalDepth || 0) * 2 + 100); this.camera.updateProjectionMatrix();
    this.overlay.replaceChildren(); this.labels = [];
    for (const anchor of this.art?.labelAnchors || []) { const node = element('span', 'aisle-cohort-label'); this.overlay.append(node); this.labels.push({ anchor, node }); }
    this.itemSelect.replaceChildren(new Option('Choose an item…', ''));
    const used = new Set();
    for (const group of this.cohorts) {
      const optgroup = element('optgroup'); optgroup.label = wallLabel(group.label, group.count, this.nouns);
      for (const key of group.keys) if (!used.has(key)) { used.add(key); optgroup.append(new Option(this.clipsByKey.get(key).title || key, key)); }
      if (optgroup.children.length) this.itemSelect.append(optgroup);
    }
    if (!this.clipsByKey.has(this.selection)) this.selection = null;
    this.itemSelect.value = this.selection || ''; this.inspectButton.disabled = !this.selection; this.itemSelect.disabled = !sorted.length; this.slider.disabled = !sorted.length;
    this.built = true; this.setLens(this.lens); this.updateStatus(); if (this.fitted) this.applyPose(); this.resize(); this.invalidate();
  }

  setLens(active) {
    this.lens = active || null; const marks = new Map(), exact = active && active.value != null;
    for (const [key, clip] of this.clipsByKey) {
      const match = exact ? matchesFacet(clip, active.key || active.model?.key, new Set([String(active.value)])) : true;
      marks.set(key, { match, color: active && !exact && active.model ? attributeMark(clip, active.model).color : undefined });
    }
    this.lensMatchKeys=exact?[...marks].filter(([,mark])=>mark.match).map(([key])=>key):[...this.clipsByKey.keys()];
    const colors = active ? new Map([...marks].map(([key, mark]) => {
      const color = mark.color ? new THREE.Color(mark.color).lerp(new THREE.Color(1, 1, 1), .55) : new THREE.Color(mark.match ? 1 : .17, mark.match ? 1 : .17, mark.match ? 1 : .17);
      return [key, color.getHex()];
    })) : null;
    this.art?.setHighlightColors(colors);
    for (const { anchor, node } of this.labels) {
      const group = this.cohorts.find(group => group.key === anchor.cohort);
      const matched = group.keys.filter(key => marks.get(key)?.match).length;
      node.textContent = exact ? `${group.label} · ${matched} / ${group.count} match` : anchor.text;
      node.title = node.textContent;
    }
    this.invalidate();
  }

  updateStatus() {
    if (this.contextLost) this.status.textContent = '3D graphics unavailable. Choose an item below to inspect it, or use the flat wall.';
    else if (!this.clipsByKey.size) this.status.textContent = 'No items in this scope. Change the search or filters to continue.';
    else this.status.textContent = '';
    this.status.hidden = !this.status.textContent;
  }

  choose(key) {
    if (!this.clipsByKey.has(key)) return;
    this.selection = key; this.itemSelect.value = key; this.inspectButton.disabled = false;
    const rack = this.art?.racks.find(rack => this.cohorts.find(group => group.key === rack.cohort)?.keys.includes(key));
    if (rack) { this.travel = clamp(rack.start / Math.max(1, this.art.totalDepth - 3.2), 0, 1); this.slider.value = String(this.travel); this.fitted = true; this.applyPose(); }
    this.interact();
  }
  open(key) { const clip = this.clipsByKey.get(key); if (!clip) return; this.selection = key; this.itemSelect.value = key; this.inspectButton.disabled = false; this.cancelHover(); this.callbacks.onOpen?.(clip); }
  pick(event) {
    if (!this.art || this.contextLost) return null;
    const rect = this.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    return this.art.pick(this.raycaster);
  }
  cancelHover() { if (this.hoverKey != null) { this.hoverKey = null; this.callbacks.onHoverEnd?.(); } }
  originRectangle() { return null; }

  applyPose() {
    if (!this.art || !this.controls) return;
    const pose = this.art.cameraPose(this.travel, this.camera.aspect); this.setCamera(pose.position, pose.target);
  }
  setCamera(position, target) {
    this.programmatic = true; this.camera.position.fromArray(position); this.controls?.target.fromArray(target); this.controls?.update(); this.camera.position.fromArray(position); this.camera.lookAt(new THREE.Vector3().fromArray(target)); this.camera.updateMatrixWorld(true); this.programmatic = false; this.invalidate();
  }
  /** Walk `distance` world units deeper (negative: back toward the entrance).
   * Travel moves as the slider moves it, but the camera keeps its angle to the
   * walls: a fitted view takes the pose at the new travel, a turned or zoomed
   * one slides along the aisle with its target. */
  walk(distance) {
    if (!this.art || !this.controls || !this.clipsByKey.size || !Number.isFinite(distance)) return false;
    const { length } = this.art.travelSpan(), from = this.travel;
    if (!(length > 0)) return false;
    const travel = Math.round(clamp(from + distance / length, 0, 1) * 1e5) / 1e5;
    if (travel === from) return false;
    this.travel = travel; this.slider.value = String(travel);
    if (this.fitted) this.applyPose();
    else {
      const step = new THREE.Vector3(0, 0, (from - travel) * length);
      this.setCamera(this.camera.position.clone().add(step).toArray(), this.controls.target.clone().add(step).toArray());
    }
    this.cancelHover(); this.interact(); return true;
  }
  fitView() { this.travel = 0; this.slider.value = '0'; this.fitted = true; this.applyPose(); this.cancelHover(); this.interact(); }
  zoomBy(factor) {
    if (!this.controls || !Number.isFinite(factor) || factor <= 0) return;
    const offset = this.camera.position.clone().sub(this.controls.target), length = clamp(offset.length() / factor, .5, 80);
    offset.setLength(length); this.camera.position.copy(this.controls.target).add(offset); this.controls.update(); this.fitted = false; this.invalidate(); this.interact();
  }
  keydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || !this.controls) return;
    if (event.key === 'Home') { event.preventDefault(); this.fitView(); return; }
    if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); this.zoomBy(event.key === '-' ? 1 / 1.15 : 1.15); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const sphere = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    if (event.key === 'ArrowLeft') sphere.theta -= .1;
    if (event.key === 'ArrowRight') sphere.theta += .1;
    if (event.key === 'ArrowUp') sphere.phi -= .08;
    if (event.key === 'ArrowDown') sphere.phi += .08;
    sphere.phi = clamp(sphere.phi, .15, Math.PI * .9);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sphere)); this.controls.update(); this.fitted = false; this.invalidate(); this.interact();
  }

  capture() { return { version: 1, travel: this.travel, spread: this.spread, position: this.camera.position.toArray(), target: this.controls?.target.toArray() || [0, 0, -10], fitted: this.fitted, selection: this.selection }; }
  restore(state) {
    if (!state || state.version !== 1) return false;
    if (!Number.isFinite(state.travel) || !Number.isFinite(state.spread) || !vector(state.position) || !vector(state.target)) return false;
    const distance = new THREE.Vector3().fromArray(state.position).distanceTo(new THREE.Vector3().fromArray(state.target));
    if (distance < .1 || distance > 1000) return false;
    this.travel = clamp(state.travel, 0, 1); this.spread = clamp(state.spread, 0, 1); this.slider.value = String(this.travel); this.fitted = state.fitted === true;
    this.selection = this.clipsByKey.has(state.selection) ? state.selection : null; this.itemSelect.value = this.selection || ''; this.inspectButton.disabled = !this.selection;
    this.art?.setPresentation({ spread: this.spread, slice: null });
    if (this.fitted) this.applyPose(); else this.setCamera(state.position, state.target);
    return true;
  }
  // Aliases keep the adapter easy to use alongside the existing spatial view.
  captureView() { return this.capture(); }
  restoreView(state) { return this.restore(state); }
  setFocused(key) { this.selection = this.clipsByKey.has(key) ? key : null; this.itemSelect.value = this.selection || ''; this.inspectButton.disabled = !this.selection; }
  captureState() { return this.capture(); }
  restoreState(state) { return this.restore(state); }
  resize() {
    if (this.disposed) return;
    const rect = this.host.getBoundingClientRect(); if (!rect.width || !rect.height) return;
    this.width = rect.width; this.height = rect.height; this.camera.aspect = rect.width / rect.height; this.camera.updateProjectionMatrix();
    this.renderer?.setSize(rect.width, rect.height, false); if (this.fitted) this.applyPose(); this.invalidate();
  }
  setVisible(on) { this.visible = !!on; this.host.hidden = !on; if (this.controls) this.controls.enabled = !!on; if (on) this.resize(); else { this.cancelHover(); if (this.frame) cancelAnimationFrame(this.frame); this.frame = null; } }
  invalidate() { if (this.frame || this.disposed || !this.visible || this.contextLost || !this.renderer) return; this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); }); }
  render() {
    if (this.disposed || !this.visible || this.contextLost || !this.renderer) return;
    this.renderer.render(this.scene, this.camera); this.renderCount = (this.renderCount || 0) + 1;
    const occupied = [], point = new THREE.Vector3();
    for (const { anchor, node } of this.labels) {
      point.copy(anchor.point).project(this.camera);
      const x = clamp((point.x + 1) / 2 * this.width, 12, Math.max(12, this.width - Math.min(250, this.width - 24)));
      const y = clamp((1 - point.y) / 2 * this.height, 12, this.height - 150);
      const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.2 && !occupied.some(p => Math.abs(p.y - y) < 38 && Math.abs(p.x - x) < 250);
      node.hidden = !visible; if (visible) { node.style.left = `${x}px`; node.style.top = `${y}px`; occupied.push({ x, y }); }
    }
  }
  getDiagnostics() { return { built: this.built, visible: this.visible, contextLost: !!this.contextLost, itemCount: this.clipsByKey.size, cohortCount: this.cohorts.length, lensMatchKeys:this.lensMatchKeys || [],
    cohorts: this.cohorts.map(group => ({ ...group })), state: this.capture(), renderCount: this.renderCount || 0,
    ...(this.art?.getDiagnostics() || {}), pickTargets: this.art && !this.contextLost ? this.art.getPickTargets(this.camera) : [],
    labels: this.labels.map(({node}) => node.textContent), selection: this.selection, graphicsError: this.graphicsError || null }; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.cancelHover(); if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect(); this.unlistenWheel?.(); for (const [node, name, fn] of this.listeners) node.removeEventListener(name, fn);
    this.controls?.dispose(); this.art?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.host.replaceChildren();
  }
}
