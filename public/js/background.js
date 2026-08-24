/**
 * Animated canvas backdrop: a rotating HUD ring system over a perspective grid
 * and a slow particle field. It breathes with the microphone level and pulses
 * brighter while Jarvis speaks.
 */

const THEMES = {
  arc: { hue: 192, grid: "rgba(70, 216, 255, 0.10)", glow: "70, 216, 255" },
  plasma: { hue: 315, grid: "rgba(255, 106, 213, 0.10)", glow: "255, 106, 213" },
  matrix: { hue: 135, grid: "rgba(92, 230, 122, 0.10)", glow: "92, 230, 122" },
  void: { hue: 205, grid: "rgba(157, 180, 196, 0.07)", glow: "157, 180, 196" },
};

const PARTICLE_COUNT = 70;

export class Background {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.theme = "arc";
    this.motion = 1;
    this.reactive = true;
    this.level = 0;
    this.smoothLevel = 0;
    this.speaking = false;
    this.awake = false;
    this.time = 0;
    this.particles = [];
    this.rafId = 0;

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  setTheme(theme) {
    this.theme = THEMES[theme] ? theme : "arc";
  }

  setMotion(motion) {
    this.motion = motion;
  }

  setReactive(reactive) {
    this.reactive = reactive;
  }

  setLevel(level) {
    this.level = level;
  }

  setState({ speaking, awake }) {
    if (speaking !== undefined) this.speaking = speaking;
    if (awake !== undefined) this.awake = awake;
  }

  resize = () => {
    const { canvas } = this;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * this.dpr);
    canvas.height = Math.floor(height * this.dpr);
    this.width = width;
    this.height = height;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seedParticles();
  };

  seedParticles() {
    this.particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: 0.6 + Math.random() * 1.8,
      vx: (Math.random() - 0.5) * 0.22,
      vy: (Math.random() - 0.5) * 0.22,
      a: 0.15 + Math.random() * 0.4,
    }));
  }

  start() {
    if (this.rafId) return;
    this.lastFrame = performance.now();
    this.frame(this.lastFrame);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  frame = (now) => {
    this.rafId = requestAnimationFrame(this.frame);
    const delta = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.time += delta * this.motion;

    const target = this.reactive ? Math.min(this.level * 3, 1) : 0;
    this.smoothLevel += (target - this.smoothLevel) * 0.15;

    this.draw();
  };

  draw() {
    const { ctx, width, height } = this;
    const theme = THEMES[this.theme];
    const energy = this.smoothLevel + (this.speaking ? 0.35 : 0) + (this.awake ? 0.15 : 0);

    ctx.clearRect(0, 0, width, height);

    const backdrop = ctx.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75,
    );
    backdrop.addColorStop(0, `rgba(${theme.glow}, ${0.1 + energy * 0.12})`);
    backdrop.addColorStop(1, "rgba(3, 6, 12, 1)");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid(theme);
    this.drawParticles(theme);
    this.drawRings(theme, energy);
  }

  drawGrid(theme) {
    const { ctx, width, height } = this;
    const horizon = height * 0.62;
    const spacing = 64;
    const drift = (this.time * 22) % spacing;

    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = -spacing; x <= width + spacing; x += spacing) {
      ctx.moveTo(x, horizon);
      ctx.lineTo(x + (x - width / 2) * 1.6, height);
    }

    for (let i = 0; i < 16; i += 1) {
      const t = (i + drift / spacing) / 16;
      const y = horizon + (height - horizon) * t * t;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }

    ctx.stroke();
  }

  drawParticles(theme) {
    const { ctx, width, height } = this;
    for (const particle of this.particles) {
      particle.x += particle.vx * this.motion;
      particle.y += particle.vy * this.motion;
      if (particle.x < 0) particle.x = width;
      if (particle.x > width) particle.x = 0;
      if (particle.y < 0) particle.y = height;
      if (particle.y > height) particle.y = 0;

      ctx.fillStyle = `rgba(${theme.glow}, ${particle.a})`;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawRings(theme, energy) {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height * 0.45;
    const base = Math.min(width, height) * 0.34 * (1 + energy * 0.06);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round";

    const rings = [
      { r: base, arcs: 3, speed: 0.22, width: 1.6, alpha: 0.5 },
      { r: base * 0.78, arcs: 5, speed: -0.34, width: 1.1, alpha: 0.36 },
      { r: base * 1.2, arcs: 2, speed: 0.14, width: 2.2, alpha: 0.22 },
    ];

    for (const ring of rings) {
      const span = (Math.PI * 2) / ring.arcs;
      for (let i = 0; i < ring.arcs; i += 1) {
        const start = this.time * ring.speed + i * span;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${theme.glow}, ${ring.alpha + energy * 0.3})`;
        ctx.lineWidth = ring.width;
        ctx.shadowBlur = 14 + energy * 26;
        ctx.shadowColor = `rgba(${theme.glow}, 0.7)`;
        ctx.arc(0, 0, ring.r, start, start + span * 0.62);
        ctx.stroke();
      }
    }

    // Level bars radiating from the centre.
    const bars = 48;
    ctx.shadowBlur = 0;
    for (let i = 0; i < bars; i += 1) {
      const angle = (i / bars) * Math.PI * 2 + this.time * 0.1;
      const wobble = Math.sin(this.time * 3 + i * 0.7) * 0.5 + 0.5;
      const length = base * 0.12 * (0.25 + wobble * energy * 2);
      const inner = base * 0.52;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(${theme.glow}, ${0.15 + energy * 0.4})`;
      ctx.lineWidth = 2;
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(
        Math.cos(angle) * (inner + length),
        Math.sin(angle) * (inner + length),
      );
      ctx.stroke();
    }

    ctx.restore();
  }
}
