import { useState, useCallback, useRef, useEffect } from 'react';
import Head from 'next/head';
import {
  searchRecipes, saveRecipe, getSavedRecipes, unsaveRecipe,
  getMyRecipes, createMyRecipe, updateMyRecipe, deleteMyRecipe,
  register as registerUser, login as loginUser,
  IngredientInput, Recipe, SearchResult, AuthUser
} from '../lib/api';
import toast from 'react-hot-toast';

/* ══════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════ */
interface IngredientRow extends IngredientInput { id: string; }
interface FlyingItem { id: string; emoji: string; x: number; y: number; tx: number; ty: number; }

const UNITS = ['pieces','grams','kg','ml','liters','cups','tbsp','tsp','oz','lbs','cloves','bunches','slices'];
const INGREDIENT_EMOJIS: Record<string,string> = {
  tomato:'🍅',onion:'🧅',garlic:'🧄',chicken:'🍗',rice:'🍚',eggs:'🥚',pasta:'🍝',
  cheese:'🧀',potato:'🥔',spinach:'🥬',mushroom:'🍄','bell pepper':'🫑',carrot:'🥕',
  lemon:'🍋',broccoli:'🥦',salmon:'🐟',beef:'🥩',tofu:'🫘',butter:'🧈',milk:'🥛',
  apple:'🍎',banana:'🍌',pineapple:'🍍',mango:'🥭',corn:'🌽',avocado:'🥑',
  ginger:'🫚',cucumber:'🥒',eggplant:'🍆',pepper:'🌶️',shrimp:'🦐',pork:'🥓',
  lamb:'🍖',cabbage:'🥬',lettuce:'🥬',onions:'🧅',
};
const getEmoji = (name: string) => INGREDIENT_EMOJIS[name.toLowerCase()] || '🫙';
const QUICK_INGREDIENTS = [
  {name:'Tomato',unit:'pieces'},{name:'Onion',unit:'pieces'},{name:'Garlic',unit:'cloves'},
  {name:'Chicken',unit:'grams'},{name:'Rice',unit:'cups'},{name:'Eggs',unit:'pieces'},
  {name:'Pasta',unit:'grams'},{name:'Cheese',unit:'grams'},{name:'Potato',unit:'pieces'},
  {name:'Spinach',unit:'cups'},{name:'Mushroom',unit:'grams'},{name:'Bell Pepper',unit:'pieces'},
  {name:'Carrot',unit:'pieces'},{name:'Broccoli',unit:'cups'},{name:'Salmon',unit:'grams'},
  {name:'Beef',unit:'grams'},{name:'Ginger',unit:'pieces'},{name:'Lemon',unit:'pieces'},
  {name:'Butter',unit:'grams'},{name:'Avocado',unit:'pieces'},
];
let idCtr = 0;
const mkId = () => `r${++idCtr}`;

/* ══════════════════════════════════════════════════════════════════
   REALISTIC KITCHEN SOUND ENGINE  v2
   Multiple noise sources, convolution-style envelope shaping,
   pink-noise sizzle, resonant bubble pops, spoon scrape + swish
══════════════════════════════════════════════════════════════════ */
class KitchenSounds {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientNodes: AudioNode[] = [];
  public enabled = false;

  private getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.65;
      this.masterGain.connect(this.ctx.destination);
    }
    if ((this.ctx as any).state === 'suspended') (this.ctx as any).resume();
    return this.ctx;
  }
  private get mg() { this.getCtx(); return this.masterGain!; }

  // ── Pink noise: 1/f spectrum, warm and natural ──
  private makePinkNoise(ctx: AudioContext, sec: number): AudioBuffer {
    const sr = ctx.sampleRate, n = sr * sec;
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
        b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
        b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    return buf;
  }

  // ── Brown noise: deep, rumbling ──
  private makeBrownNoise(ctx: AudioContext, sec: number): AudioBuffer {
    const sr = ctx.sampleRate, n = sr * sec;
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) {
      last += (Math.random()*2-1)*0.02; last *= 0.998;
      last = Math.max(-0.5,Math.min(0.5,last));
      d[i] = last * 2.8;
    }
    return buf;
  }

  // ── White noise (short transients) ──
  private makeWhiteNoise(ctx: AudioContext, sec: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr*sec, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random()*2-1;
    return buf;
  }

  enable()  { this.enabled = true;  this.startAmbient(); }
  disable() { this.enabled = false; this.stopAmbient(); }
  toggle()  { this.enabled ? this.disable() : this.enable(); return this.enabled; }

  // ── AMBIENT: 3-layer sizzle/boil soundscape ──
  startAmbient() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();

      // LAYER 1: High sizzle — pink noise → hi-pass → soft tremolo
      const sizzBuf = this.makePinkNoise(ctx, 6);
      const sizz = ctx.createBufferSource();
      sizz.buffer = sizzBuf; sizz.loop = true;
      const sHP = ctx.createBiquadFilter(); sHP.type='highpass'; sHP.frequency.value=2200;
      const sLP = ctx.createBiquadFilter(); sLP.type='lowpass';  sLP.frequency.value=9000;
      const sTrem = ctx.createOscillator(); sTrem.type='triangle'; sTrem.frequency.value=5.5;
      const sTremG = ctx.createGain(); sTremG.gain.value = 0.25;
      const sG = ctx.createGain(); sG.gain.value=0;
      sG.gain.linearRampToValueAtTime(0.22, ctx.currentTime+2.5);
      sTrem.connect(sTremG); sTremG.connect(sG.gain);
      sizz.connect(sHP); sHP.connect(sLP); sLP.connect(sG); sG.connect(this.mg);
      sizz.start(); sTrem.start();
      this.ambientNodes.push(sizz, sTrem);

      // LAYER 2: Mid bubble rumble — brown noise → bandpass 80–300 Hz
      const rumBuf = this.makeBrownNoise(ctx, 8);
      const rum = ctx.createBufferSource();
      rum.buffer = rumBuf; rum.loop = true;
      const rBP = ctx.createBiquadFilter(); rBP.type='bandpass'; rBP.frequency.value=140; rBP.Q.value=0.6;
      const rG = ctx.createGain(); rG.gain.value=0;
      rG.gain.linearRampToValueAtTime(0.18, ctx.currentTime+4);
      rum.connect(rBP); rBP.connect(rG); rG.connect(this.mg);
      rum.start();
      this.ambientNodes.push(rum);

      // LAYER 3: Occasional random bubble pop every ~1.2s
      const popInterval = () => {
        if (!this.enabled) return;
        this.fireBubblePop(0.12);
        setTimeout(popInterval, 900 + Math.random()*700);
      };
      setTimeout(popInterval, 1500);

    } catch(e) { console.warn('Audio init:', e); }
  }

  stopAmbient() {
    try {
      if (!this.ctx || !this.masterGain) return;
      this.masterGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.9);
      setTimeout(() => {
        this.ambientNodes.forEach(n => { try { (n as any).stop?.(); } catch(e){} });
        this.ambientNodes = [];
        if (this.masterGain) this.masterGain.gain.value = 0.65;
      }, 1000);
    } catch(e) {}
  }

  // ── Single resonant bubble pop ──
  private fireBubblePop(vol = 0.2) {
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      // Resonant sine sweeps down (water bubble bursting at surface)
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.value = 320; filt.Q.value = 3;
      o.type = 'sine';
      o.frequency.setValueAtTime(680, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.09);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o.connect(filt); filt.connect(g); g.connect(this.mg);
      o.start(t); o.stop(t + 0.15);
    } catch(e) {}
  }

  // ── SPLASH: ingredient hits hot liquid ──
  // Layered: impact thud + sizzle burst + 3 bubble pops
  playSplash() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;

      // Impact: pitched low thud, pitch-drops fast
      const imp = ctx.createOscillator();
      const impG = ctx.createGain();
      imp.type = 'sine';
      imp.frequency.setValueAtTime(220, t);
      imp.frequency.exponentialRampToValueAtTime(35, t + 0.12);
      impG.gain.setValueAtTime(0.85, t);
      impG.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      imp.connect(impG); impG.connect(this.mg);
      imp.start(t); imp.stop(t + 0.16);

      // Splash body: pink noise burst through peaking EQ (mid-scoop)
      const spBuf = this.makePinkNoise(ctx, 0.9);
      const sp = ctx.createBufferSource(); sp.buffer = spBuf;
      const spHP = ctx.createBiquadFilter(); spHP.type='highpass'; spHP.frequency.value=800;
      const spPeak = ctx.createBiquadFilter(); spPeak.type='peaking'; spPeak.frequency.value=2800; spPeak.gain.value=8;
      const spG = ctx.createGain();
      spG.gain.setValueAtTime(0.85, t+0.02);
      spG.gain.setValueAtTime(0.6,  t+0.05);
      spG.gain.exponentialRampToValueAtTime(0.001, t+0.75);
      sp.connect(spHP); spHP.connect(spPeak); spPeak.connect(spG); spG.connect(this.mg);
      sp.start(t+0.02); sp.stop(t+0.8);

      // 3 staggered bubble pops after splash
      [0.1, 0.22, 0.40].forEach(dt => {
        setTimeout(() => this.fireBubblePop(0.3 - dt*0.5), dt*1000);
      });

    } catch(e) {}
  }

  // ── STIR: wooden spoon on ceramic + liquid slosh ──
  playStir() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;
      const revs = 2.0; // seconds of stirring

      // Spoon scrape — brown noise + notch filter, 6 strokes
      const scBuf = this.makeBrownNoise(ctx, 0.18);
      [0, 0.20, 0.40, 0.60, 0.82, 1.05, 1.28, 1.52].forEach((dt, i) => {
        const sc = ctx.createBufferSource(); sc.buffer = scBuf;
        const scLP = ctx.createBiquadFilter(); scLP.type='lowpass'; scLP.frequency.value=1100+i*80;
        const scNotch = ctx.createBiquadFilter(); scNotch.type='notch'; scNotch.frequency.value=400; scNotch.Q.value=2;
        const scG = ctx.createGain();
        scG.gain.setValueAtTime(0,          t+dt);
        scG.gain.linearRampToValueAtTime(0.42, t+dt+0.04);
        scG.gain.linearRampToValueAtTime(0.22, t+dt+0.12);
        scG.gain.linearRampToValueAtTime(0,   t+dt+0.18);
        sc.connect(scLP); scLP.connect(scNotch); scNotch.connect(scG); scG.connect(this.mg);
        sc.start(t+dt); sc.stop(t+dt+0.2);
      });

      // Liquid slosh — amplitude-modulated pink noise, slowly sweeping freq
      const slBuf = this.makePinkNoise(ctx, revs+0.3);
      const sl = ctx.createBufferSource(); sl.buffer = slBuf;
      const slBP = ctx.createBiquadFilter(); slBP.type='bandpass'; slBP.frequency.value=380; slBP.Q.value=1.2;
      // LFO mimics circular slosh (2 Hz)
      const lfo = ctx.createOscillator(); lfo.type='sine'; lfo.frequency.value=2.2;
      const lfoG = ctx.createGain(); lfoG.gain.value=0.06;
      const slG = ctx.createGain();
      slG.gain.setValueAtTime(0,    t);
      slG.gain.linearRampToValueAtTime(0.18, t+0.25);
      slG.gain.linearRampToValueAtTime(0.10, t+revs-0.2);
      slG.gain.linearRampToValueAtTime(0,    t+revs);
      lfo.connect(lfoG); lfoG.connect(slG.gain);
      sl.connect(slBP); slBP.connect(slG); slG.connect(this.mg);
      sl.start(t); lfo.start(t);
      sl.stop(t+revs+0.1); lfo.stop(t+revs+0.1);

      // Ceramic clink at start of stir
      const clk = ctx.createOscillator();
      const clkG = ctx.createGain();
      clk.type = 'triangle'; clk.frequency.value = 1420;
      clkG.gain.setValueAtTime(0.28, t);
      clkG.gain.exponentialRampToValueAtTime(0.0001, t+0.07);
      clk.connect(clkG); clkG.connect(this.mg);
      clk.start(t); clk.stop(t+0.08);

    } catch(e) {}
  }

  // ── BOIL UP: searching — heat increases, rapid bubbles + steam hiss ──
  playBoilUp() {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      const t = ctx.currentTime;

      // Rapid bubble cascade (18 pops, accelerating)
      for (let i = 0; i < 18; i++) {
        const dt = i * 0.055 + Math.random()*0.02;
        const o = ctx.createOscillator(); const g = ctx.createGain();
        const freq = 150 + Math.random()*550;
        o.type = 'sine';
        o.frequency.setValueAtTime(freq,       t+dt);
        o.frequency.exponentialRampToValueAtTime(freq*0.28, t+dt+0.10);
        g.gain.setValueAtTime(0.22,  t+dt);
        g.gain.exponentialRampToValueAtTime(0.0001, t+dt+0.12);
        o.connect(g); g.connect(this.mg);
        o.start(t+dt); o.stop(t+dt+0.13);
      }

      // Steam hiss: pink noise through high-pass, swells and fades
      const hBuf = this.makePinkNoise(ctx, 1.5);
      const h = ctx.createBufferSource(); h.buffer = hBuf;
      const hHP = ctx.createBiquadFilter(); hHP.type='highpass'; hHP.frequency.value=3500;
      const hLP = ctx.createBiquadFilter(); hLP.type='lowpass';  hLP.frequency.value=10000;
      const hG = ctx.createGain();
      hG.gain.setValueAtTime(0,    t);
      hG.gain.linearRampToValueAtTime(0.55, t+0.25);
      hG.gain.linearRampToValueAtTime(0.20, t+0.9);
      hG.gain.linearRampToValueAtTime(0,    t+1.4);
      h.connect(hHP); hHP.connect(hLP); hLP.connect(hG); hG.connect(this.mg);
      h.start(t); h.stop(t+1.5);

    } catch(e) {}
  }
}
const sounds = typeof window !== 'undefined' ? new KitchenSounds() : null;

/* ══════════════════════════════════════════════════════════════════
   CANVAS POT v3
   - True parametric spiral swirl drawn point-by-point (NOT ellipse rotation)
   - Ladle spoon that physically follows the stir path through liquid
   - Splash particles, steam, animated flame
══════════════════════════════════════════════════════════════════ */
interface IngredientParticle {
  emoji: string;
  angle: number;
  radius: number;
  opacity: number;
  scale: number;
  born: number;
  vr: number; // radial drift speed when stirring
}

interface SplashDrop {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  r: number; emoji: string;
  opacity?: number;
}

function PotCanvas({ ingredients, isStirring }: {
  ingredients: IngredientRow[];
  isStirring: boolean;
  lastAdded: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  const stateRef = useRef({
    frame: 0,
    // ── Spoon state ──
    spoonAngle: Math.PI * 0.75,   // where on the orbit circle the bowl tip is (radians)
    spoonDepth: 0,                // 0 = handle resting outside, 1 = fully stirring inside
    stirTimer: 0,
    stirDuration: 135,            // ~2.25 s at 60fps
    activeStir: false,
    // ── Liquid ──
    swirlStrength: 0,             // 0..1
    swirlAngleOffset: 0,          // accumulated spiral phase
    bubbles: [] as {x:number,y:number,r:number,life:number,maxLife:number}[],
    bubbleTimer: 0,
    // ── Particles ──
    particles: [] as IngredientParticle[],
    splashDrops: [] as SplashDrop[],
    ingredients: [] as IngredientRow[],
    // ── Steam ──
    steamPuffs: [] as {x:number,y:number,vx:number,vy:number,r:number,life:number,maxLife:number, opacity?: number;}[],
    steamTimer: 0,
  });

  // ── Sync ingredients prop → particle list ──
  useEffect(() => {
    const s = stateRef.current;
    if (ingredients.length > s.ingredients.length) {
      const added = ingredients[ingredients.length - 1];
      const emoji = getEmoji(added.name);
      // New particle on surface
      s.particles.push({
        emoji,
        angle: Math.random() * Math.PI * 2,
        radius: 18 + Math.random() * 28,
        opacity: 0, scale: 0,
        born: s.frame,
        vr: (Math.random() - 0.5) * 0.01,
      });
      // Splash drops
      const cx = 110, ry = 78;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.splashDrops.push({
          x: cx + Math.cos(a)*12, y: ry + Math.sin(a)*5,
          vx: Math.cos(a)*(1.5+Math.random()*2),
          vy: -(1.5+Math.random()*2),
          life: 0, maxLife: 18+Math.random()*10,
          r: 1.5+Math.random()*2,
          emoji,
        });
      }
    }
    s.ingredients = [...ingredients];
    if (s.particles.length > 8) s.particles.splice(0, s.particles.length - 8);
  }, [ingredients]);

  // ── Sync isStirring prop ──
  useEffect(() => {
    const s = stateRef.current;
    if (isStirring) {
      s.activeStir   = true;
      s.stirTimer    = 0;
      s.swirlStrength = 1;
    }
  }, [isStirring]);

  // ── Main render loop (stable, no deps) ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Canvas geometry
    const W = 240, H = 260;
    canvas.width = W; canvas.height = H;

    // Pot geometry
    const CX = 120, CY = 108;
    const POT_RX = 80, POT_BOTTOM = 170;
    const RIM_Y  = 76;
    const RIM_RX = 72, RIM_RY = 14;
    const LIQ_RX = 64, LIQ_RY = 11.5;

    // Stir orbit  (the path the ladle TIP follows in the liquid)
    const ORBIT_RX = 42, ORBIT_RY = 7.5;

    // ── Helper: point on orbit ellipse ──
    const orbitPt = (a: number) => ({
      x: CX + Math.cos(a) * ORBIT_RX,
      y: RIM_Y + Math.sin(a) * ORBIT_RY,
    });

    function drawFrame() {
      const s = stateRef.current;
      s.frame++;
      ctx.clearRect(0, 0, W, H);

      const hasLiq = s.ingredients.length > 0;

      // ──────────────── Physics ────────────────
      // Stir lifecycle
      if (s.activeStir && s.stirTimer < s.stirDuration) {
        s.stirTimer++;
        const p = s.stirTimer / s.stirDuration;
        // ease in 20%, full stir 60%, ease out 20%
        if      (p < 0.18) s.spoonDepth = p / 0.18;
        else if (p > 0.82) s.spoonDepth = (1-p) / 0.18;
        else               s.spoonDepth = 1;
        // advance spoon along orbit (2 full laps)
        s.spoonAngle += (Math.PI * 4) / s.stirDuration;
        // swirl accumulates
        s.swirlAngleOffset += 0.055;
        s.swirlStrength = Math.max(0.35, s.swirlStrength - 0.001);
      } else if (s.stirTimer >= s.stirDuration) {
        s.activeStir  = false;
        s.spoonDepth  = Math.max(0, s.spoonDepth - 0.055);
        s.swirlStrength = Math.max(0, s.swirlStrength - 0.007);
        if (s.swirlStrength > 0) s.swirlAngleOffset += s.swirlStrength * 0.03;
      } else {
        s.spoonDepth  = Math.max(0, s.spoonDepth - 0.04);
        s.swirlStrength = Math.max(0, s.swirlStrength - 0.004);
        if (s.swirlStrength > 0) s.swirlAngleOffset += s.swirlStrength * 0.015;
      }

      // Bubbles
      if (hasLiq) {
        s.bubbleTimer++;
        const freq = s.activeStir ? 3 : 14;
        if (s.bubbleTimer % freq === 0) {
          s.bubbles.push({
            x: CX + (Math.random()-0.5)*LIQ_RX*1.5,
            y: RIM_Y + (Math.random()-0.5)*LIQ_RY*1.6,
            r: 1.2+Math.random()*2.8,
            life: 0, maxLife: 16+Math.random()*22,
          });
        }
      }
      s.bubbles = s.bubbles.filter(b => { b.life++; return b.life < b.maxLife; });

      // Splash drops physics
      s.splashDrops = s.splashDrops.filter(d => {
        d.x += d.vx; d.y += d.vy; d.vy += 0.18; d.life++;
        return d.life < d.maxLife;
      });

      // Steam
      if (hasLiq) {
        s.steamTimer++;
        if (s.steamTimer % (s.activeStir ? 10 : 20) === 0) {
          s.steamPuffs.push({
            x: CX + (Math.random()-0.5)*36,
            y: RIM_Y - 4,
            vx: (Math.random()-0.5)*0.4,
            vy: -(0.7+Math.random()*0.6),
            r: 3+Math.random()*5,
            life: 0, maxLife: 38+Math.random()*22,
          });
        }
      }
      s.steamPuffs = s.steamPuffs.filter(p => {
        p.life++; p.x += p.vx + Math.sin(p.life*0.22)*0.35;
        p.y += p.vy; p.r += 0.14;
        return p.life < p.maxLife;
      });

      // Ingredient particles drift with swirl
      s.particles.forEach(p => {
        const age = s.frame - p.born;
        p.opacity = Math.min(1, age / 12);
        p.scale   = Math.min(1, age / 12);
        if (s.swirlStrength > 0.02) {
          p.angle  += s.swirlStrength * 0.032;
          p.radius += p.vr;
          p.radius  = Math.max(10, Math.min(36, p.radius));
        }
      });

      // ──────────────── Draw ────────────────

      // === FLAME ===
      if (hasLiq) {
        const ft = s.frame * 0.07;
        ctx.save();
        for (let fi = 0; fi < 9; fi++) {
          const fx = CX - 34 + fi * 8.5 + Math.sin(ft*1.1+fi)*1.2;
          const fh = 12 + Math.sin(ft*1.4+fi*0.9)*4.5;
          const fg = ctx.createLinearGradient(fx, POT_BOTTOM+8, fx, POT_BOTTOM+8-fh);
          fg.addColorStop(0, 'rgba(255,45,0,0.92)');
          fg.addColorStop(0.45,'rgba(255,130,0,0.85)');
          fg.addColorStop(1, 'rgba(255,230,0,0.15)');
          ctx.beginPath();
          ctx.moveTo(fx, POT_BOTTOM+9);
          ctx.bezierCurveTo(fx-3, POT_BOTTOM+9-fh*0.38, fx+2.5, POT_BOTTOM+9-fh*0.72, fx, POT_BOTTOM+9-fh);
          ctx.bezierCurveTo(fx-2, POT_BOTTOM+9-fh*0.62, fx-3.5, POT_BOTTOM+9-fh*0.28, fx, POT_BOTTOM+9);
          ctx.fillStyle = fg; ctx.fill();
        }
        ctx.restore();
      }

      // === POT SHADOW ===
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(CX, POT_BOTTOM+8, POT_RX*0.82, 7, 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill();
      ctx.restore();

      // === POT BODY ===
      const potG = ctx.createLinearGradient(CX-POT_RX, CY, CX+POT_RX, CY);
      potG.addColorStop(0,   '#A85020');
      potG.addColorStop(0.3, '#CC6838');
      potG.addColorStop(0.52,'#E2845A');
      potG.addColorStop(1,   '#944018');
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(CX-POT_RX, RIM_Y);
      ctx.bezierCurveTo(CX-POT_RX, POT_BOTTOM-12, CX-22, POT_BOTTOM+3, CX, POT_BOTTOM+3);
      ctx.bezierCurveTo(CX+22, POT_BOTTOM+3, CX+POT_RX, POT_BOTTOM-12, CX+POT_RX, RIM_Y);
      ctx.closePath();
      ctx.fillStyle = potG; ctx.fill();
      // pot shine
      ctx.beginPath();
      ctx.ellipse(CX-22, CY+14, 11, 27, -0.28, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
      ctx.restore();

      // === HANDLES ===
      [-1, 1].forEach(dir => {
        const hcx = CX + dir*(POT_RX+3);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(hcx, RIM_Y+5, 13, 7, 0, 0, Math.PI*2);
        ctx.fillStyle = '#7A2E14'; ctx.fill();
        ctx.beginPath();
        ctx.ellipse(hcx, RIM_Y+5, 10, 5, 0, 0, Math.PI*2);
        ctx.fillStyle = '#9E4422'; ctx.fill();
        ctx.restore();
      });

      // === LIQUID SURFACE (clipped) ===
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(CX, RIM_Y, RIM_RX-1, RIM_RY, 0, 0, Math.PI*2);
      ctx.clip();

      // Base liquid colour
      const liqG = ctx.createRadialGradient(CX, RIM_Y, 0, CX, RIM_Y, LIQ_RX);
      liqG.addColorStop(0,   hasLiq ? '#F5BF80' : '#BF6828');
      liqG.addColorStop(0.65,hasLiq ? '#E49858' : '#9E4820');
      liqG.addColorStop(1,   '#A84C18');
      ctx.beginPath();
      ctx.ellipse(CX, RIM_Y, LIQ_RX, LIQ_RY, 0, 0, Math.PI*2);
      ctx.fillStyle = liqG; ctx.fill();

      // ── TRUE PARAMETRIC SPIRAL SWIRL ──
      // We draw the swirl as a series of elliptical arcs with *shrinking radii*,
      // sampled point-by-point so it forms an actual inward spiral (not a rotating ellipse).
      if (hasLiq && s.swirlStrength > 0.015) {
        const sw = s.swirlStrength;
        const ao = s.swirlAngleOffset;
        const STEPS = 120;
        const LOOPS = 1.65; // how many times it spirals inward

        // Draw 2 concentric spiral trails for depth
        [0.55, 0.35].forEach((baseR, layer) => {
          ctx.beginPath();
          let first = true;
          for (let i = 0; i <= STEPS; i++) {
            const t = i / STEPS;
            // radius shrinks from baseR → 0.05 of LIQ_RX as t→1
            const r = (baseR - t * (baseR - 0.05));
            const a = ao + t * LOOPS * Math.PI * 2;
            // map to ellipse coords
            const px = CX + Math.cos(a) * r * LIQ_RX;
            const py = RIM_Y + Math.sin(a) * r * LIQ_RY;
            if (first) { ctx.moveTo(px, py); first = false; }
            else         ctx.lineTo(px, py);
          }
          const alpha = sw * (layer === 0 ? 0.55 : 0.30);
          const lw    = layer === 0 ? 2.5 : 1.5;
          const color = layer === 0
            ? `rgba(255,228,170,${alpha})`
            : `rgba(255,200,120,${alpha})`;
          ctx.strokeStyle = color;
          ctx.lineWidth   = lw;
          ctx.lineCap     = 'round';
          ctx.stroke();
        });

        // Centre highlight dot
        if (sw > 0.2) {
          ctx.beginPath();
          ctx.arc(CX, RIM_Y, 2.5, 0, Math.PI*2);
          ctx.fillStyle = `rgba(255,240,200,${sw*0.5})`;
          ctx.fill();
        }
      }

      // Bubbles
      s.bubbles.forEach(b => {
        const a = 1 - b.life/b.maxLife;
        const rise = (b.life/b.maxLife) * 2.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y-rise, b.r, 0, Math.PI*2);
        ctx.strokeStyle = `rgba(255,205,145,${a*0.85})`;
        ctx.lineWidth = 0.9; ctx.stroke();
        // glint
        ctx.beginPath();
        ctx.arc(b.x-b.r*0.35, b.y-rise-b.r*0.35, b.r*0.28, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,245,210,${a*0.55})`; ctx.fill();
      });

      // Ingredient emoji particles (flattened to sit on ellipse surface)
      s.particles.forEach(p => {
        const px = CX + Math.cos(p.angle)*p.radius;
        const py = RIM_Y + Math.sin(p.angle)*(LIQ_RY*0.8);
        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(px, py);
        ctx.scale(p.scale*0.82, p.scale*0.42);
        ctx.font = '15px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p.emoji, 0, 0);
        ctx.restore();
      });

      ctx.restore(); // end liquid clip

      // === RIM ===
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(CX, RIM_Y, RIM_RX, RIM_RY, 0, 0, Math.PI*2);
      const rimG = ctx.createLinearGradient(CX-RIM_RX, RIM_Y, CX+RIM_RX, RIM_Y);
      rimG.addColorStop(0,   '#7E2C12');
      rimG.addColorStop(0.38,'#C05828');
      rimG.addColorStop(0.62,'#D26838');
      rimG.addColorStop(1,   '#6E2010');
      ctx.strokeStyle = rimG; ctx.lineWidth = 7; ctx.stroke();
      ctx.restore();

      // === SPLASH DROPS ===
      s.splashDrops.forEach(d => {
        const a = 1 - d.life/d.maxLife;
        if (a < 0.1) return;
        ctx.save();
        ctx.globalAlpha = a * 0.9;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(240,180,90,0.9)'; ctx.fill();
        ctx.restore();
      });

      // === SPOON / LADLE ===
      // The ladle tip follows the orbit ellipse.
      // Handle always points to upper-right at a fixed diagonal.
      // spoonDepth 0→1 lowers the tip from ~40px above rim down into the liquid.

      const tip = orbitPt(s.spoonAngle);
      // Vertical offset: depth=0 → tip hovers 44px above rim; depth=1 → tip at rim level
      const tipRiseWhenOut = 44;
      const tipY = tip.y - tipRiseWhenOut * (1 - s.spoonDepth);

      // Tangent direction of orbit at this angle (for handle alignment)
      const tangA = s.spoonAngle + Math.PI * 0.5; // 90° ahead of position
      // Handle root = fixed upper-right corner, always the same anchor
      const handleRoot = { x: W - 18, y: 22 };

      // --- Draw back half of handle (behind pot rim) first, then liquid, then front ---
      // Actually draw the whole handle now (it goes over the rim visually)
      const handleLen = 90;
      // Direction from tip to handle root
      const hDir = Math.atan2(handleRoot.y - tipY, handleRoot.x - tip.x);
      // Mid control point for slight curve
      const midX = tip.x + Math.cos(hDir)*handleLen*0.5 + Math.sin(tangA)*8*s.spoonDepth;
      const midY = tipY  + Math.sin(hDir)*handleLen*0.5 - Math.cos(tangA)*5*s.spoonDepth;

      // Handle shadow
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tip.x+2, tipY+3);
      ctx.quadraticCurveTo(midX+2, midY+3, handleRoot.x+2, handleRoot.y+3);
      ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.stroke();
      // Handle wood
      const hGrad = ctx.createLinearGradient(tip.x, tipY, handleRoot.x, handleRoot.y);
      hGrad.addColorStop(0,   '#BA6A28');
      hGrad.addColorStop(0.4, '#E09050');
      hGrad.addColorStop(0.7, '#CA7838');
      hGrad.addColorStop(1,   '#A05018');
      ctx.beginPath();
      ctx.moveTo(tip.x, tipY);
      ctx.quadraticCurveTo(midX, midY, handleRoot.x, handleRoot.y);
      ctx.strokeStyle = hGrad; ctx.lineWidth = 5.5; ctx.lineCap = 'round'; ctx.stroke();
      ctx.restore();

      // Ladle bowl at tip (always drawn, bigger when inside liquid)
      const bowlScale = 0.6 + s.spoonDepth * 0.5;
      const bowlRX = 11 * bowlScale, bowlRY = 7 * bowlScale;
      const bowlAngle = hDir + Math.PI; // bowl opens toward handle direction

      ctx.save();
      ctx.translate(tip.x, tipY);
      ctx.rotate(bowlAngle - Math.PI/2);

      // Bowl shadow
      ctx.beginPath();
      ctx.ellipse(1.5, 1.5, bowlRX, bowlRY, 0, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill();
      // Bowl body gradient
      const bGrad = ctx.createRadialGradient(-bowlRX*0.3, -bowlRY*0.3, 0.5, 0, 0, bowlRX*1.2);
      bGrad.addColorStop(0, '#F5E0A0');
      bGrad.addColorStop(0.55,'#D9A050');
      bGrad.addColorStop(1,   '#9C5A18');
      ctx.beginPath();
      ctx.ellipse(0, 0, bowlRX, bowlRY, 0, 0, Math.PI*2);
      ctx.fillStyle = bGrad; ctx.fill();
      ctx.strokeStyle = '#8A4010'; ctx.lineWidth = 1.2; ctx.stroke();
      // Liquid in bowl when stirring
      if (s.spoonDepth > 0.55 && hasLiq) {
        ctx.beginPath();
        ctx.ellipse(0, bowlRY*0.18, bowlRX*0.68, bowlRY*0.52, 0, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(238,170,80,0.78)'; ctx.fill();
      }
      // Specular glint
      ctx.beginPath();
      ctx.ellipse(-bowlRX*0.3, -bowlRY*0.3, bowlRX*0.28, bowlRY*0.22, -0.5, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,250,220,0.45)'; ctx.fill();

      ctx.restore();

      // === STEAM PUFFS ===
      s.steamPuffs.forEach(p => {
        const a = p.opacity = 0.52*(1-p.life/p.maxLife);
        ctx.save();
        ctx.globalAlpha = a;
        const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        sg.addColorStop(0, 'rgba(230,222,215,0.92)');
        sg.addColorStop(1, 'rgba(218,210,205,0)');
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        ctx.fillStyle = sg; ctx.fill();
        ctx.restore();
      });

      rafRef.current = requestAnimationFrame(drawFrame);
    }

    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div id="pot-target" style={{ display:'flex', flexDirection:'column', alignItems:'center', userSelect:'none' }}>
      <canvas ref={canvasRef} style={{ imageRendering:'crisp-edges' }} />
      {ingredients.length > 0 && (
        <div style={{
          marginTop: -14, background:'var(--terracotta)', color:'white',
          borderRadius:20, padding:'2px 14px', fontSize:13, fontWeight:700,
          boxShadow:'0 2px 10px rgba(193,104,58,0.45)',
        }}>
          {ingredients.length} ingredient{ingredients.length>1?'s':''} in pot
        </div>
      )}
      <p style={{ marginTop:9, fontSize:12, color:'var(--text-light)', textAlign:'center', fontWeight:500 }}>
        {ingredients.length === 0 ? '🫙 Add ingredients to start!' :
         ingredients.length === 1 ? '✨ Keep adding more!' :
         ingredients.length < 3  ? '🌿 Looking tasty!' : '🔥 Ready to find recipes!'}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   FLYING EMOJIS
══════════════════════════════════════════════════════════════════ */
function FlyingEmojis({ items }: { items: FlyingItem[] }) {
  return (
    <>
      {items.map(item => (
        <div key={item.id} style={{
          position:'fixed', left:item.x, top:item.y, fontSize:26,
          pointerEvents:'none', zIndex:9999,
          '--tx': `${item.tx}px`, '--ty': `${item.ty}px`,
          animation:'fly-to-pot 0.85s cubic-bezier(0.4,0,0.2,1) forwards',
        } as any}>{item.emoji}</div>
      ))}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SMART INGREDIENT SEARCH
══════════════════════════════════════════════════════════════════ */
function SmartIngredientSearch({ onAddIngredient, existingIngredients }: {
  onAddIngredient: (ing:{name:string,unit:string}, btnEl:HTMLElement) => void;
  existingIngredients: IngredientRow[];
}) {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const trimmed = search.trim();
  const lower = trimmed.toLowerCase();
  const filtered = QUICK_INGREDIENTS.filter(i => !trimmed || i.name.toLowerCase().includes(lower));
  const exactMatch = QUICK_INGREDIENTS.find(i => i.name.toLowerCase() === lower);
  const alreadyAdded = existingIngredients.some(i => i.name.toLowerCase() === lower);
  const showDrop = focused && trimmed.length > 0;

  const doAdd = (ing:{name:string,unit:string}, el:HTMLElement) => {
    onAddIngredient(ing, el); setSearch(''); inputRef.current?.focus();
  };

  useEffect(() => {
    const h = (e:MouseEvent) => {
      if (dropRef.current?.contains(e.target as Node) || inputRef.current?.contains(e.target as Node)) return;
      setFocused(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div style={{position:'relative'}}>
      <div style={{position:'relative'}}>
        <span style={{position:'absolute',left:14,top:'50%',transform:'translateY(-50%)',fontSize:18,pointerEvents:'none'}}>🔎</span>
        <input ref={inputRef} className="input-fresh" style={{paddingLeft:42}}
          placeholder="Search or add any ingredient..."
          value={search}
          onChange={e => { setSearch(e.target.value); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && trimmed && !alreadyAdded) {
              const use = exactMatch || filtered[0] || {name:trimmed.charAt(0).toUpperCase()+trimmed.slice(1),unit:'pieces'};
              doAdd(use, e.currentTarget as unknown as HTMLElement);
            }
            if (e.key === 'Escape') setFocused(false);
          }}
        />
      </div>
      {showDrop && (
        <div ref={dropRef} style={{
          position:'absolute',top:'calc(100% + 6px)',left:0,right:0,
          background:'white',borderRadius:16,border:'1.5px solid #DDE8D8',
          boxShadow:'0 8px 32px rgba(135,168,120,0.2)',zIndex:100,maxHeight:280,overflowY:'auto',
        }}>
          {filtered.length > 0 ? (
            <>
              <div style={{padding:'8px 12px 4px',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)'}}>
                Known Ingredients
              </div>
              {filtered.map(ing => {
                const isIn = existingIngredients.some(i => i.name.toLowerCase() === ing.name.toLowerCase());
                return (
                  <button key={ing.name}
                    onMouseDown={e => { e.preventDefault(); if (!isIn) doAdd(ing, e.currentTarget); }}
                    style={{
                      width:'100%',textAlign:'left',padding:'9px 14px',display:'flex',
                      alignItems:'center',gap:10,fontSize:14,border:'none',
                      background:isIn?'#F7FBF5':'transparent',
                      color:isIn?'var(--sage)':'var(--text-dark)',
                      cursor:isIn?'default':'pointer',
                    }}
                    onMouseEnter={e=>{ if(!isIn)(e.currentTarget as HTMLButtonElement).style.background='#F0F7ED'; }}
                    onMouseLeave={e=>{ (e.currentTarget as HTMLButtonElement).style.background=isIn?'#F7FBF5':'transparent'; }}>
                    <span style={{fontSize:20}}>{getEmoji(ing.name)}</span>
                    <span style={{flex:1}}>{ing.name}</span>
                    {isIn
                      ? <span style={{fontSize:12,color:'var(--sage)',fontWeight:600}}>✓ In pot</span>
                      : <span style={{fontSize:11,color:'var(--text-light)',background:'#EEF5EB',padding:'2px 8px',borderRadius:20}}>+ add</span>
                    }
                  </button>
                );
              })}
              {!exactMatch && trimmed && (
                <div style={{borderTop:'1px solid #EEF5EB',padding:'6px 10px 10px'}}>
                  <button
                    onMouseDown={e => { e.preventDefault(); if(!alreadyAdded) doAdd({name:trimmed.charAt(0).toUpperCase()+trimmed.slice(1),unit:'pieces'},e.currentTarget); }}
                    style={{
                      width:'100%',padding:'9px 14px',borderRadius:12,
                      background:alreadyAdded?'#F7FBF5':'linear-gradient(135deg,var(--sage),var(--sage-dark))',
                      color:alreadyAdded?'var(--sage)':'white',fontWeight:600,fontSize:13,
                      cursor:alreadyAdded?'default':'pointer',border:'none',
                      display:'flex',alignItems:'center',gap:8,
                    }}>
                    {alreadyAdded ? <>✓ Already in pot</> : <>✨ Add "{trimmed.charAt(0).toUpperCase()+trimmed.slice(1)}" to pot</>}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{padding:'10px 14px'}}>
              <button
                onMouseDown={e=>{e.preventDefault();if(!alreadyAdded)doAdd({name:trimmed.charAt(0).toUpperCase()+trimmed.slice(1),unit:'pieces'},e.currentTarget);}}
                style={{
                  width:'100%',padding:'10px 14px',borderRadius:12,
                  background:alreadyAdded?'#F7FBF5':'linear-gradient(135deg,var(--terracotta),#E08055)',
                  color:alreadyAdded?'var(--sage)':'white',fontWeight:600,fontSize:13,
                  cursor:alreadyAdded?'default':'pointer',border:'none',
                  display:'flex',alignItems:'center',gap:8,
                }}>
                {alreadyAdded?<>✓ Already in pot</>:<>✨ Add "{trimmed.charAt(0).toUpperCase()+trimmed.slice(1)}" to pot</>}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   POT SECTION
══════════════════════════════════════════════════════════════════ */
function PotSection({ ingredients, onAdd, onRemove, onUpdate, onAddIngredient, isStirring, lastAdded }:{
  ingredients:IngredientRow[]; onAdd:()=>void; onRemove:(id:string)=>void;
  onUpdate:(id:string,field:keyof IngredientInput,val:string)=>void;
  onAddIngredient:(ing:{name:string,unit:string},btnEl:HTMLElement)=>void;
  isStirring:boolean; lastAdded:string|null;
}) {
  return (
    <div className="pot-section p-6 mb-6">
      <div style={{display:'flex',gap:32,alignItems:'flex-start',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:280}}>
          <h3 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'var(--sage-dark)',marginBottom:12}}>
            ⚡ Add Ingredients
          </h3>
          <div style={{marginBottom:14}}>
            <SmartIngredientSearch onAddIngredient={onAddIngredient} existingIngredients={ingredients} />
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:7,marginBottom:18}}>
            {QUICK_INGREDIENTS.slice(0,12).map(ing => {
              const inPot = ingredients.some(i=>i.name.toLowerCase()===ing.name.toLowerCase());
              return (
                <button key={ing.name}
                  className={`tag ${inPot?'':'tag-ingredient'}`}
                  onClick={e=>!inPot&&onAddIngredient(ing,e.currentTarget)}
                  style={inPot?{background:'#EEF5EB',color:'var(--sage-dark)',
                    border:'1.5px solid var(--sage)',opacity:0.75,cursor:'default'}:{}}>
                  {getEmoji(ing.name)} {ing.name}{inPot?<span style={{marginLeft:3,fontSize:10}}>✓</span>:null}
                </button>
              );
            })}
          </div>
          <h3 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',
            color:'var(--sage-dark)',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
            🥘 Your Ingredients
            {ingredients.length>0&&<span style={{background:'var(--sage)',color:'white',borderRadius:20,padding:'1px 9px',fontSize:11,fontWeight:700}}>{ingredients.length}</span>}
          </h3>
          {ingredients.length===0&&(
            <div style={{textAlign:'center',padding:'16px 0',color:'var(--text-light)',fontSize:13}}>
              <div style={{fontSize:28,marginBottom:4}}>🫙</div>
              Search or tap chips above to add
            </div>
          )}
          <div style={{display:'flex',flexDirection:'column',gap:7,marginBottom:10}}>
            {ingredients.map(ing=>(
              <div key={ing.id} style={{display:'flex',gap:7,alignItems:'center'}} className="animate-fade-up">
                <span style={{fontSize:20,width:26,textAlign:'center',flexShrink:0}}>{getEmoji(ing.name)}</span>
                <input className="input-fresh" style={{flex:1}} placeholder="Ingredient…"
                  value={ing.name} onChange={e=>onUpdate(ing.id,'name',e.target.value)}/>
                <input className="input-fresh" style={{width:60}} placeholder="Qty"
                  value={ing.quantity} onChange={e=>onUpdate(ing.id,'quantity',e.target.value)}/>
                <select className="input-fresh" style={{width:104,background:'white'}}
                  value={ing.unit} onChange={e=>onUpdate(ing.id,'unit',e.target.value)}>
                  {UNITS.map(u=><option key={u}>{u}</option>)}
                </select>
                <button onClick={()=>onRemove(ing.id)} style={{
                  width:28,height:28,borderRadius:'50%',background:'#FDE8E0',color:'var(--terracotta)',
                  fontWeight:700,fontSize:13,flexShrink:0,display:'flex',alignItems:'center',
                  justifyContent:'center',border:'none',cursor:'pointer',transition:'transform 0.15s',
                }}
                onMouseEnter={e=>(e.currentTarget.style.transform='scale(1.15)')}
                onMouseLeave={e=>(e.currentTarget.style.transform='scale(1)')}>✕</button>
              </div>
            ))}
          </div>
          <button onClick={onAdd} style={{
            fontSize:13,fontWeight:600,padding:'6px 14px',borderRadius:12,
            background:'white',border:'1.5px dashed #C8DEC2',color:'var(--sage-dark)',cursor:'pointer',
          }}>+ Add Custom Row</button>
        </div>
        <div style={{flexShrink:0,display:'flex',justifyContent:'center',paddingTop:4}}>
          <PotCanvas ingredients={ingredients} isStirring={isStirring} lastAdded={lastAdded}/>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   RECIPE MODAL
══════════════════════════════════════════════════════════════════ */
function RecipeModal({ recipe, onClose, onSave, onUnsave, savedIds, currentUser }:{
  recipe:Recipe; onClose:()=>void; onSave:(r:Recipe)=>void; onUnsave:(id:string)=>void;
  savedIds:Set<string>; currentUser:AuthUser|null;
}) {
  const isSaved = recipe._id ? savedIds.has(recipe._id) : !!recipe.isSaved;
  const totalSaves = recipe.savedByUserIds?.length ?? recipe.likes ?? 0;
  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{if(e.key==='Escape')onClose();};
    document.addEventListener('keydown',h);
    document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',h);document.body.style.overflow='';};
  },[onClose]);
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e=>e.stopPropagation()}>
        {(recipe.imageBase64||recipe.imageUrl)&&(
          <div style={{position:'relative',height:220,overflow:'hidden',borderRadius:'28px 28px 0 0'}}>
            <img src={recipe.imageBase64||recipe.imageUrl} alt={recipe.title} style={{width:'100%',height:'100%',objectFit:'cover'}}
              onError={e=>{(e.target as HTMLImageElement).style.display='none';}}/>
            <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(45,36,24,0.7) 0%,transparent 55%)'}}/>
            <button onClick={onClose} style={{position:'absolute',top:14,right:14,width:34,height:34,borderRadius:'50%',
              background:'rgba(255,255,255,0.92)',border:'none',fontSize:18,cursor:'pointer',fontWeight:700}}>✕</button>
            {recipe.source&&<span style={{position:'absolute',bottom:14,left:14,padding:'3px 10px',borderRadius:20,
              fontSize:12,fontWeight:600,background:'rgba(0,0,0,0.45)',color:'white'}}>📍{recipe.source}</span>}
            {recipe.isUserCreated&&<span style={{position:'absolute',top:14,left:14,padding:'4px 12px',borderRadius:20,
              fontSize:12,fontWeight:700,background:'var(--sage)',color:'white'}}>⭐ My Recipe</span>}
            {/* Veg/Non-veg badge */}
            <span style={{position:'absolute',top:14,left:recipe.isUserCreated?130:14,padding:'4px 10px',borderRadius:20,
              fontSize:11,fontWeight:700,background:recipe.isVegetarian?'rgba(72,160,90,0.92)':'rgba(200,60,40,0.92)',color:'white'}}>
              {recipe.isVegetarian?'🌿 Vegetarian':'🍖 Non-Veg'}
            </span>
          </div>
        )}
        <div style={{padding:24}}>
          {!(recipe.imageBase64||recipe.imageUrl)&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{padding:'4px 10px',borderRadius:20,fontSize:11,fontWeight:700,
              background:recipe.isVegetarian?'#E6F5E9':'#FDE8E0',
              color:recipe.isVegetarian?'#2E7D32':'#C62828'}}>
              {recipe.isVegetarian?'🌿 Vegetarian':'🍖 Non-Veg'}
            </span>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#F0F0EE',border:'none',cursor:'pointer',fontSize:16}}>✕</button>
          </div>}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:16}}>
            <div>
              <h2 style={{fontFamily:'Lora,serif',fontSize:22,fontWeight:700,color:'var(--text-dark)',lineHeight:1.3}}>{recipe.title}</h2>
              {recipe.cuisine&&<span style={{fontSize:12,color:'var(--text-light)'}}>🌍 {recipe.cuisine}{recipe.difficulty?` · ${recipe.difficulty}`:''}</span>}
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:6,flexShrink:0}}>
              <button onClick={()=>isSaved&&recipe._id?onUnsave(recipe._id):onSave(recipe)} style={{
                padding:'8px 16px',borderRadius:12,fontWeight:600,fontSize:13,
                border:isSaved?'2px solid #E84545':'none',cursor:'pointer',transition:'all 0.2s',
                background:isSaved?'#FDE8E0':'var(--terracotta)',color:isSaved?'var(--terracotta)':'white',
              }}>{isSaved?'❤️ Saved':'🤍 Save'}</button>
              {totalSaves > 0 && <span style={{fontSize:11,color:'var(--text-light)'}}>{totalSaves} {totalSaves===1?'person':'people'} saved this</span>}
            </div>
          </div>
          {recipe.description&&<p style={{color:'var(--text-mid)',fontSize:14,lineHeight:1.6,marginBottom:14}}>{recipe.description}</p>}
          <div style={{display:'flex',flexWrap:'wrap',gap:14,padding:'10px 14px',borderRadius:12,background:'#F5F0E8',marginBottom:16}}>
            {recipe.prepTime&&<span style={{fontSize:13,fontWeight:600,color:'var(--text-mid)'}}>⏱ Prep: {recipe.prepTime}</span>}
            {recipe.cookTime&&<span style={{fontSize:13,fontWeight:600,color:'var(--text-mid)'}}>🔥 Cook: {recipe.cookTime}</span>}
            {recipe.servings&&<span style={{fontSize:13,fontWeight:600,color:'var(--text-mid)'}}>👥 Serves: {recipe.servings}</span>}
            {recipe.calories&&<span style={{fontSize:13,fontWeight:600,color:'var(--text-mid)'}}>🔢 {recipe.calories}</span>}
          </div>
          {recipe.tags?.length>0&&<div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:14}}>
            {recipe.tags.map(t=><span key={t} style={{padding:'3px 12px',borderRadius:20,fontSize:12,fontWeight:600,background:'#EEF5EB',color:'var(--sage-dark)'}}>#{t}</span>)}
          </div>}
          <div style={{marginBottom:16}}>
            <h3 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'var(--sage-dark)',marginBottom:8}}>Ingredients</h3>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {recipe.ingredients.map((ing,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:7,padding:'6px 9px',borderRadius:9,background:'#F7FBF5',fontSize:13,color:'var(--text-dark)'}}>
                  <span>{getEmoji(ing.split(' ').pop()||ing)}</span><span>{ing}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{marginBottom:16}}>
            <h3 style={{fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.1em',color:'var(--sage-dark)',marginBottom:8}}>Instructions</h3>
            <ol style={{listStyle:'none',display:'flex',flexDirection:'column',gap:9}}>
              {recipe.instructions.map((step,i)=>(
                <li key={i} style={{display:'flex',gap:9,fontSize:13,color:'var(--text-mid)',lineHeight:1.5}}>
                  <span style={{flexShrink:0,width:21,height:21,borderRadius:'50%',background:'var(--terracotta)',
                    color:'white',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center'}}>{i+1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          {recipe.sourceUrl&&(
            <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{
                display:'flex',alignItems:'center',justifyContent:'center',gap:8,
                padding:'12px',borderRadius:14,marginBottom:16,
                background:'linear-gradient(135deg,#1a73e8,#0d47a1)',color:'white',
                fontWeight:700,fontSize:14,textDecoration:'none',
                boxShadow:'0 4px 14px rgba(26,115,232,0.3)',
              }}>
              🔗 View Full Recipe on {recipe.source||'Source'} ↗
            </a>
          )}
          {/* ── Recipe Credit ── */}
          <div style={{borderTop:'1px solid #EEF5EB',paddingTop:14,marginTop:4}}>
            {recipe.createdByName ? (
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,var(--sage),var(--terracotta))',
                  display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:14,fontWeight:700}}>
                  {recipe.createdByName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p style={{fontSize:12,color:'var(--text-light)',margin:0}}>Recipe shared by</p>
                  <p style={{fontSize:13,fontWeight:700,color:'var(--text-dark)',margin:0}}>{recipe.createdByName}</p>
                </div>
              </div>
            ) : (
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:32,height:32,borderRadius:'50%',background:'linear-gradient(135deg,#6366f1,#8b5cf6)',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>✨</div>
                <div>
                  <p style={{fontSize:12,color:'var(--text-light)',margin:0}}>Recipe generated by</p>
                  <p style={{fontSize:13,fontWeight:700,color:'var(--text-dark)',margin:0}}>ChefAI × Google Gemini</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   RECIPE CARD
══════════════════════════════════════════════════════════════════ */
function RecipeCard({ recipe, index, onClick, onSave, onUnsave, savedIds }:{
  recipe:Recipe; index:number; onClick:()=>void;
  onSave:(r:Recipe)=>void; onUnsave:(id:string)=>void; savedIds:Set<string>;
}) {
  const isSaved = recipe._id ? savedIds.has(recipe._id) : !!recipe.isSaved;
  return(
    <div className="recipe-card animate-fade-up" style={{animationDelay:`${index*0.07}s`,cursor:'pointer'}} onClick={onClick}>
      <div style={{position:'relative',height:172,overflow:'hidden'}}>
        {(recipe.imageBase64||recipe.imageUrl)
          ?<img src={recipe.imageBase64||recipe.imageUrl} alt={recipe.title} className="card-img"
            style={{width:'100%',height:'100%',objectFit:'cover',transition:'transform 0.5s'}}
            onError={e=>{(e.target as HTMLImageElement).style.display='none';}}/>
          :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:44,background:'linear-gradient(135deg,#EEF5EB,#E0EDD9)'}}>🍽️</div>
        }
        <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(45,36,24,0.55) 0%,transparent 55%)'}}/>
        <div style={{position:'absolute',top:10,left:10,display:'flex',gap:5,flexWrap:'wrap'}}>
          {recipe.isUserCreated&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:700,background:'var(--sage)',color:'white'}}>⭐ Community</span>}
          {!recipe.isUserCreated&&recipe.source&&<span style={{padding:'2px 8px',borderRadius:20,fontSize:10,fontWeight:600,background:'rgba(0,0,0,0.5)',color:'white'}}>🌐 {recipe.source}</span>}
        </div>
        {/* Veg badge */}
        <span style={{position:'absolute',top:10,right:44,padding:'2px 6px',borderRadius:20,fontSize:9,fontWeight:700,
          background:recipe.isVegetarian?'rgba(34,139,34,0.88)':'rgba(180,40,30,0.88)',color:'white'}}>
          {recipe.isVegetarian?'🌿':'🍖'}
        </span>
        {recipe.cuisine&&<span style={{position:'absolute',bottom:9,left:9,padding:'2px 7px',borderRadius:20,fontSize:10,fontWeight:600,background:'rgba(0,0,0,0.45)',color:'white'}}>🌍 {recipe.cuisine}</span>}
        <button onClick={e=>{e.stopPropagation();isSaved&&recipe._id?onUnsave(recipe._id):onSave(recipe);}} style={{
          position:'absolute',top:9,right:9,width:32,height:32,borderRadius:'50%',
          border:isSaved?'2px solid #E84545':'none',background:isSaved?'rgba(255,255,255,0.95)':'rgba(255,255,255,0.88)',
          cursor:'pointer',fontSize:17,display:'flex',alignItems:'center',justifyContent:'center',
          boxShadow:'0 2px 8px rgba(0,0,0,0.15)',transition:'transform 0.2s',
        }}
        onMouseEnter={e=>(e.currentTarget.style.transform='scale(1.15)')}
        onMouseLeave={e=>(e.currentTarget.style.transform='scale(1)')}>
          {isSaved?'❤️':'🤍'}
        </button>
      </div>
      <div style={{padding:14}}>
        <h3 style={{fontFamily:'Lora,serif',fontWeight:700,fontSize:14,color:'var(--text-dark)',
          marginBottom:4,lineHeight:1.3,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
          {recipe.title}
        </h3>
        <p style={{fontSize:12,color:'var(--text-light)',marginBottom:9,lineHeight:1.45,
          display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
          {recipe.description}
        </p>
        <div style={{display:'flex',gap:9,fontSize:11,color:'var(--text-light)',marginBottom:8}}>
          {recipe.prepTime&&<span>⏱{recipe.prepTime}</span>}
          {recipe.cookTime&&<span>🔥{recipe.cookTime}</span>}
          {recipe.servings&&<span>👥{recipe.servings}</span>}
          {(recipe.savedByUserIds?.length||0)>0&&<span style={{marginLeft:'auto',color:'var(--terracotta)',fontWeight:600}}>❤️ {recipe.savedByUserIds!.length}</span>}
        </div>
        {/* Show ingredients OR a "View Original" CTA for web recipes */}
        {recipe.sourceUrl ? (
          <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer"
            onClick={e=>e.stopPropagation()}
            style={{
              display:'flex',alignItems:'center',justifyContent:'center',gap:6,
              padding:'7px',borderRadius:10,fontSize:12,fontWeight:700,
              background:'linear-gradient(135deg,#1a73e8,#0d47a1)',color:'white',
              textDecoration:'none',transition:'opacity 0.2s',
            }}
            onMouseEnter={e=>(e.currentTarget as HTMLAnchorElement).style.opacity='0.85'}
            onMouseLeave={e=>(e.currentTarget as HTMLAnchorElement).style.opacity='1'}>
            🔗 View Full Recipe on {recipe.source||'Source'}
          </a>
        ) : (
          <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
            {recipe.ingredients.slice(0,3).map((ing,i)=>(
              <span key={i} style={{padding:'2px 7px',borderRadius:20,fontSize:11,background:'#EEF5EB',color:'var(--sage-dark)'}}>
                {ing.split(' ').slice(-1)[0]}
              </span>
            ))}
            {recipe.ingredients.length>3&&<span style={{padding:'2px 7px',borderRadius:20,fontSize:11,background:'#F5F0E8',color:'var(--text-light)'}}>+{recipe.ingredients.length-3}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MY RECIPE FORM MODAL (create & edit)
══════════════════════════════════════════════════════════════════ */
function MyRecipeFormModal({ existing, onClose, onSaved }:{
  existing?: Recipe; onClose:()=>void; onSaved:(r:Recipe, isEdit:boolean)=>void;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState({
    title: existing?.title || '',
    description: existing?.description || '',
    ingredientsText: existing?.ingredients?.join('\n') || '',
    instructionsText: existing?.instructions?.join('\n') || '',
    prepTime: existing?.prepTime || '',
    cookTime: existing?.cookTime || '',
    servings: existing?.servings || '',
    cuisine: existing?.cuisine || '',
    tags: existing?.tags?.join(', ') || '',
  });
  const [imagePreview, setImagePreview] = useState<string>(existing?.imageBase64 || existing?.imageUrl || '');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{ document.body.style.overflow='hidden'; return()=>{ document.body.style.overflow=''; }; },[]);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { toast.error('Image too large (max 3MB)'); return; }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const h = (f: string) => (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) => setForm(p=>({...p,[f]:e.target.value}));

  const submit = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!form.ingredientsText.trim()) { toast.error('At least one ingredient is required'); return; }
    setSaving(true);
    try {
      const payload: Partial<Recipe> = {
        title: form.title.trim(),
        description: form.description.trim(),
        ingredients: form.ingredientsText.split('\n').map(s=>s.trim()).filter(Boolean),
        instructions: form.instructionsText.split('\n').map(s=>s.trim()).filter(Boolean),
        prepTime: form.prepTime, cookTime: form.cookTime, servings: form.servings,
        cuisine: form.cuisine,
        tags: form.tags.split(',').map(s=>s.trim()).filter(Boolean),
        isUserCreated: true, source: 'Community Recipe',
        imageBase64: imagePreview.startsWith('data:') ? imagePreview : undefined,
        imageUrl: !imagePreview.startsWith('data:') ? imagePreview : undefined,
      };
      let saved: Recipe;
      if (isEdit && existing?._id) {
        saved = await updateMyRecipe(existing._id, payload);
        toast.success('Recipe updated! ✏️');
      } else {
        saved = await createMyRecipe(payload);
        toast.success('Recipe published! 🎉 Everyone can see it.');
      }
      onSaved(saved, isEdit);
    } catch(e:any) { toast.error(e.response?.data?.message || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex:200,overflowY:'auto',padding:'20px 0'}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:'white',borderRadius:28,width:'100%',maxWidth:580,
        boxShadow:'0 24px 80px rgba(0,0,0,0.18)',animation:'modalIn 0.25s ease',margin:'auto',
      }}>
        {/* Header with gradient */}
        <div style={{background:'linear-gradient(135deg,var(--sage),#6a9a5b)',borderRadius:'28px 28px 0 0',padding:'20px 24px',color:'white'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <h2 style={{fontFamily:'Lora,serif',fontSize:20,fontWeight:700}}>{isEdit?'✏️ Edit Recipe':'✍️ Share Your Recipe'}</h2>
              <p style={{fontSize:12,opacity:0.85,marginTop:2}}>{isEdit?'Update your recipe details':'Your recipe will be visible to everyone searching those ingredients'}</p>
            </div>
            <button onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'rgba(255,255,255,0.2)',border:'none',cursor:'pointer',fontSize:16,color:'white',flexShrink:0}}>✕</button>
          </div>
        </div>

        <div style={{padding:24,display:'flex',flexDirection:'column',gap:14}}>
          {/* Image upload */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:6}}>Recipe Photo</label>
            <div onClick={()=>fileRef.current?.click()} style={{
              border:'2px dashed #C8DEC2',borderRadius:16,overflow:'hidden',cursor:'pointer',
              height:imagePreview?'auto':120,minHeight:120,display:'flex',alignItems:'center',
              justifyContent:'center',background:'#F7FBF5',position:'relative',transition:'all 0.2s',
            }}
            onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.borderColor='var(--sage)'}
            onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.borderColor='#C8DEC2'}>
              {imagePreview
                ? <>
                    <img src={imagePreview} alt="preview" style={{width:'100%',maxHeight:240,objectFit:'cover',display:'block'}}/>
                    <div style={{position:'absolute',bottom:8,right:8,padding:'4px 10px',borderRadius:20,background:'rgba(0,0,0,0.5)',color:'white',fontSize:11,fontWeight:600}}>Click to change</div>
                  </>
                : <div style={{textAlign:'center',color:'var(--text-light)'}}>
                    <div style={{fontSize:32,marginBottom:6}}>📸</div>
                    <p style={{fontSize:13,fontWeight:600}}>Click to upload photo</p>
                    <p style={{fontSize:11,marginTop:2}}>JPG, PNG · Max 3MB</p>
                  </div>
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleImage}/>
          </div>

          {/* Title */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Title *</label>
            <input className="input-fresh" placeholder="e.g. Grandma's Pasta al Pomodoro" value={form.title} onChange={h('title')}/>
          </div>

          {/* Description */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Description</label>
            <textarea className="input-fresh" rows={2} placeholder="A short appetising description..." value={form.description} onChange={h('description')}/>
          </div>

          {/* Ingredients */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Ingredients * <span style={{fontWeight:400,textTransform:'none'}}>(one per line)</span></label>
            <textarea className="input-fresh" rows={5} placeholder={'2 cups rice\n3 garlic cloves\n1 tbsp olive oil\n...'} value={form.ingredientsText} onChange={h('ingredientsText')}/>
          </div>

          {/* Instructions */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Instructions <span style={{fontWeight:400,textTransform:'none'}}>(one step per line)</span></label>
            <textarea className="input-fresh" rows={5} placeholder={'Heat oil in a pan\nAdd garlic, cook 1 minute\nAdd rice and stir well\n...'} value={form.instructionsText} onChange={h('instructionsText')}/>
          </div>

          {/* Meta row */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:9}}>
            {([['prepTime','Prep','15 mins'],['cookTime','Cook','30 mins'],['servings','Serves','4'],['cuisine','Cuisine','Indian']] as const).map(([f,l,p])=>(
              <div key={f}>
                <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--sage-dark)',marginBottom:4}}>{l}</label>
                <input className="input-fresh" style={{fontSize:13}} placeholder={p} value={(form as any)[f]} onChange={h(f)}/>
              </div>
            ))}
          </div>

          {/* Tags */}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Tags <span style={{fontWeight:400,textTransform:'none'}}>(comma separated)</span></label>
            <input className="input-fresh" placeholder="italian, quick, vegetarian, family" value={form.tags} onChange={h('tags')}/>
          </div>

          {/* Buttons */}
          <div style={{display:'flex',gap:9,marginTop:4}}>
            <button onClick={onClose} style={{flex:1,padding:'12px',borderRadius:12,background:'#F0EEE8',border:'none',cursor:'pointer',fontWeight:600,color:'var(--text-mid)'}}>Cancel</button>
            <button onClick={submit} disabled={saving} style={{
              flex:2,padding:'12px',borderRadius:12,fontWeight:700,fontSize:14,
              background:'linear-gradient(135deg,var(--sage),#6a9a5b)',color:'white',
              border:'none',cursor:saving?'not-allowed':'pointer',opacity:saving?0.7:1,
              boxShadow:'0 6px 20px rgba(135,168,120,0.35)',
            }}>
              {saving
                ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    <span style={{width:15,height:15,border:'2px solid white',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/> Saving...
                  </span>
                : isEdit ? '✏️ Update Recipe' : '🚀 Publish Recipe'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MY RECIPES PANEL
══════════════════════════════════════════════════════════════════ */
function MyRecipesPanel({ currentUser, onOpen, onLogin }:{ currentUser: AuthUser|null; onOpen:(r:Recipe)=>void; onLogin:()=>void; }) {
  const [myRecipes, setMyRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRecipe, setEditRecipe] = useState<Recipe|undefined>();

  useEffect(()=>{
    if (!currentUser) { setLoading(false); return; }
    getMyRecipes().then(setMyRecipes).catch(()=>setMyRecipes([])).finally(()=>setLoading(false));
  },[currentUser]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recipe? This cannot be undone.')) return;
    try {
      await deleteMyRecipe(id);
      setMyRecipes(p=>p.filter(r=>r._id!==id));
      toast.success('Recipe deleted');
    } catch { toast.error('Failed to delete'); }
  };

  const handleSaved = (r: Recipe, isEdit: boolean) => {
    if (isEdit) setMyRecipes(p=>p.map(x=>x._id===r._id?r:x));
    else setMyRecipes(p=>[r,...p]);
    setShowForm(false);
    setEditRecipe(undefined);
  };

  if (!currentUser) return (
    <div style={{textAlign:'center',padding:'60px 0'}}>
      <div style={{fontSize:52,marginBottom:12}}>🔒</div>
      <h3 style={{fontFamily:'Lora,serif',fontSize:20,fontWeight:700,color:'var(--text-dark)',marginBottom:8}}>Login to manage your recipes</h3>
      <p style={{fontSize:14,color:'var(--text-light)',marginBottom:20}}>Create an account to publish recipes visible to everyone</p>
      <button onClick={onLogin} style={{padding:'10px 28px',borderRadius:12,background:'var(--terracotta)',color:'white',fontWeight:700,border:'none',cursor:'pointer',fontSize:14}}>🔑 Login / Register</button>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
        <div>
          <h2 style={{fontFamily:'Lora,serif',fontSize:22,fontWeight:700,color:'var(--text-dark)'}}>
            👨‍🍳 My Recipes
            {myRecipes.length>0&&<span style={{marginLeft:8,fontSize:13,fontWeight:600,padding:'2px 10px',borderRadius:20,background:'#EEF5EB',color:'var(--sage-dark)'}}>{myRecipes.length}</span>}
          </h2>
          <p style={{fontSize:13,color:'var(--text-light)',marginTop:3}}>Your published recipes are visible to all users searching those ingredients</p>
        </div>
        <button onClick={()=>{setEditRecipe(undefined);setShowForm(true);}} style={{
          padding:'10px 20px',borderRadius:14,background:'linear-gradient(135deg,var(--sage),#6a9a5b)',
          color:'white',fontWeight:700,fontSize:14,border:'none',cursor:'pointer',
          boxShadow:'0 4px 14px rgba(135,168,120,0.35)',
        }}>+ New Recipe</button>
      </div>

      {loading ? (
        <div style={{textAlign:'center',padding:'48px',color:'var(--text-light)'}}>
          <span style={{width:32,height:32,border:'3px solid #DDE8D8',borderTopColor:'var(--sage)',borderRadius:'50%',display:'inline-block',animation:'spin 0.8s linear infinite'}}/>
        </div>
      ) : myRecipes.length === 0 ? (
        <div style={{textAlign:'center',padding:'56px 0',borderRadius:20,background:'#F7FBF5',border:'2px dashed #C8DEC2'}}>
          <div style={{fontSize:52,marginBottom:10}}>👨‍🍳</div>
          <p style={{fontWeight:700,fontSize:16,color:'var(--text-dark)',marginBottom:6}}>No recipes yet</p>
          <p style={{fontSize:13,color:'var(--text-light)',marginBottom:18}}>Share your first recipe — it'll appear in search results for everyone!</p>
          <button onClick={()=>setShowForm(true)} style={{padding:'10px 24px',borderRadius:12,background:'var(--sage)',color:'white',fontWeight:700,border:'none',cursor:'pointer'}}>✍️ Share First Recipe</button>
        </div>
      ) : (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:18}}>
          {myRecipes.map((recipe,i) => (
            <div key={recipe._id||i} style={{background:'white',borderRadius:20,overflow:'hidden',border:'1.5px solid var(--border)',boxShadow:'0 2px 12px rgba(0,0,0,0.06)',transition:'transform 0.2s',cursor:'pointer'}}
              onMouseEnter={e=>(e.currentTarget as HTMLDivElement).style.transform='translateY(-2px)'}
              onMouseLeave={e=>(e.currentTarget as HTMLDivElement).style.transform=''}
            >
              {/* Image */}
              <div style={{height:160,overflow:'hidden',position:'relative'}} onClick={()=>onOpen(recipe)}>
                {(recipe.imageBase64||recipe.imageUrl)
                  ? <img src={recipe.imageBase64||recipe.imageUrl} alt={recipe.title} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                  : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:48,background:'linear-gradient(135deg,#EEF5EB,#E0EDD9)'}}>🍽️</div>
                }
                <div style={{position:'absolute',inset:0,background:'linear-gradient(to top,rgba(0,0,0,0.4),transparent)'}}/>
                <span style={{position:'absolute',top:10,left:10,padding:'3px 9px',borderRadius:20,fontSize:10,fontWeight:700,
                  background:recipe.isVegetarian?'rgba(34,139,34,0.9)':'rgba(180,40,30,0.9)',color:'white'}}>
                  {recipe.isVegetarian?'🌿 VEG':'🍖 NON-VEG'}
                </span>
                {(recipe.savedByUserIds?.length||0)>0&&(
                  <span style={{position:'absolute',bottom:10,right:10,padding:'3px 9px',borderRadius:20,fontSize:11,fontWeight:700,background:'rgba(0,0,0,0.5)',color:'white'}}>
                    ❤️ {recipe.savedByUserIds!.length}
                  </span>
                )}
              </div>

              {/* Content */}
              <div style={{padding:14}}>
                <h3 onClick={()=>onOpen(recipe)} style={{fontFamily:'Lora,serif',fontWeight:700,fontSize:15,color:'var(--text-dark)',marginBottom:4,lineHeight:1.3}}>{recipe.title}</h3>
                <p style={{fontSize:12,color:'var(--text-light)',marginBottom:10,lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden'}}>{recipe.description}</p>
                <div style={{display:'flex',gap:8,fontSize:11,color:'var(--text-light)',marginBottom:12}}>
                  {recipe.prepTime&&<span>⏱ {recipe.prepTime}</span>}
                  {recipe.cookTime&&<span>🔥 {recipe.cookTime}</span>}
                  {recipe.cuisine&&<span>🌍 {recipe.cuisine}</span>}
                </div>
                {/* Actions */}
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>onOpen(recipe)} style={{flex:1,padding:'7px',borderRadius:10,background:'#F0F7ED',border:'none',cursor:'pointer',fontWeight:600,fontSize:12,color:'var(--sage-dark)'}}>👁 View</button>
                  <button onClick={()=>{setEditRecipe(recipe);setShowForm(true);}} style={{flex:1,padding:'7px',borderRadius:10,background:'#FFF3E0',border:'none',cursor:'pointer',fontWeight:600,fontSize:12,color:'#E65100'}}>✏️ Edit</button>
                  <button onClick={()=>recipe._id&&handleDelete(recipe._id)} style={{flex:1,padding:'7px',borderRadius:10,background:'#FDECEA',border:'none',cursor:'pointer',fontWeight:600,fontSize:12,color:'#C62828'}}>🗑 Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && <MyRecipeFormModal existing={editRecipe} onClose={()=>{setShowForm(false);setEditRecipe(undefined);}} onSaved={handleSaved}/>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   SAVED PANEL
══════════════════════════════════════════════════════════════════ */
function SavedPanel({ savedRecipes, onOpen, onUnsave, savedIds }:{
  savedRecipes:Recipe[]; onOpen:(r:Recipe)=>void; onUnsave:(id:string)=>void; savedIds:Set<string>;
}) {
  return(
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
        <h2 style={{fontFamily:'Lora,serif',fontSize:22,fontWeight:700,color:'var(--text-dark)'}}>
          🔖 Saved Recipes
          {savedRecipes.length>0&&<span style={{marginLeft:8,fontSize:13,fontWeight:600,padding:'2px 10px',borderRadius:20,background:'#EEF5EB',color:'var(--sage-dark)'}}>{savedRecipes.length}</span>}
        </h2>
      </div>
      {savedRecipes.length===0
        ?<div style={{textAlign:'center',padding:'56px 0',borderRadius:20,background:'#F7FBF5',border:'2px dashed #C8DEC2'}}>
          <div style={{fontSize:44,marginBottom:8}}>📭</div>
          <p style={{fontWeight:600,color:'var(--text-mid)'}}>No saved recipes yet</p>
          <p style={{fontSize:13,color:'var(--text-light)',marginTop:4}}>Search for recipes and click ❤️ to save them here</p>
        </div>
        :<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:18}}>
          {savedRecipes.map((r,i)=><RecipeCard key={r._id||i} recipe={r} index={i} onClick={()=>onOpen(r)}
            onSave={()=>{}} onUnsave={onUnsave} savedIds={savedIds}/>)}
        </div>
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   AUTH MODAL  (Login / Register)
══════════════════════════════════════════════════════════════════ */
function AuthModal({ onClose, onSuccess }:{
  onClose:()=>void;
  onSuccess:(token:string, user:AuthUser)=>void;
}) {
  const [mode,setMode]=useState<'login'|'register'>('login');
  const [name,setName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow='';};
  },[]);

  const submit=async()=>{
    setError('');
    if(!email||!password){setError('Email and password required');return;}
    if(mode==='register'&&!name.trim()){setError('Name required');return;}
    if(password.length<6){setError('Password must be at least 6 characters');return;}
    setLoading(true);
    try{
      const res = mode==='register'
        ? await registerUser(name,email,password)
        : await loginUser(email,password);
      onSuccess(res.access_token, res.user);
    }catch(e:any){
      setError(e.response?.data?.message || 'Something went wrong. Please try again.');
    }finally{setLoading(false);}
  };

  return(
    <div className="modal-overlay" onClick={onClose} style={{zIndex:200}}>
      <div onClick={e=>e.stopPropagation()} style={{
        background:'white',borderRadius:28,padding:32,width:'100%',maxWidth:400,
        boxShadow:'0 24px 80px rgba(0,0,0,0.2)',animation:'modalIn 0.25s ease',
      }}>
        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
          <div>
            <h2 style={{fontFamily:'Lora,serif',fontSize:22,fontWeight:700,color:'var(--text-dark)'}}>
              {mode==='login'?'👋 Welcome back':'🍴 Create account'}
            </h2>
            <p style={{fontSize:13,color:'var(--text-light)',marginTop:2}}>
              {mode==='login'?'Login to save your favourite recipes':'Join ChefAI to start saving recipes'}
            </p>
          </div>
          <button onClick={onClose} style={{width:32,height:32,borderRadius:'50%',background:'#F0F0EE',border:'none',cursor:'pointer',fontSize:16,flexShrink:0}}>✕</button>
        </div>

        {/* Mode toggle */}
        <div style={{display:'flex',background:'#F5F0E8',borderRadius:12,padding:4,marginBottom:22,gap:4}}>
          {(['login','register'] as const).map(m=>(
            <button key={m} onClick={()=>{setMode(m);setError('');}} style={{
              flex:1,padding:'8px',borderRadius:9,fontSize:13,fontWeight:600,border:'none',cursor:'pointer',transition:'all 0.18s',
              background:mode===m?'white':'transparent',
              color:mode===m?'var(--text-dark)':'var(--text-mid)',
              boxShadow:mode===m?'0 2px 8px rgba(0,0,0,0.08)':'none',
            }}>{m==='login'?'Log In':'Register'}</button>
          ))}
        </div>

        {/* Fields */}
        <div style={{display:'flex',flexDirection:'column',gap:13}}>
          {mode==='register'&&(
            <div>
              <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Your Name</label>
              <input className="input-fresh" placeholder="e.g. Shreya Dhoke" value={name} onChange={e=>setName(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&submit()}/>
            </div>
          )}
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Email</label>
            <input className="input-fresh" type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&submit()}/>
          </div>
          <div>
            <label style={{display:'block',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'var(--sage-dark)',marginBottom:5}}>Password</label>
            <input className="input-fresh" type="password" placeholder="Min 6 characters" value={password} onChange={e=>setPassword(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&submit()}/>
          </div>
        </div>

        {error&&(
          <div style={{marginTop:12,padding:'9px 13px',borderRadius:10,background:'#FDE8E0',border:'1px solid #F4C0B0',fontSize:13,color:'#C62828',fontWeight:500}}>
            ⚠️ {error}
          </div>
        )}

        <button onClick={submit} disabled={loading} style={{
          width:'100%',marginTop:20,padding:'13px',borderRadius:14,fontWeight:700,fontSize:15,
          background:'linear-gradient(135deg,var(--terracotta),#E08055)',color:'white',
          border:'none',cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1,
          boxShadow:'0 6px 20px rgba(193,104,58,0.3)',transition:'all 0.2s',
        }}>
          {loading
            ? <span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                <span style={{width:16,height:16,border:'2px solid white',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'spin 0.7s linear infinite'}}/>
                {mode==='login'?'Logging in...':'Creating account...'}
              </span>
            : mode==='login'?'🔑 Log In':'🚀 Create Account'
          }
        </button>

        <p style={{textAlign:'center',fontSize:12,color:'var(--text-light)',marginTop:14}}>
          {mode==='login'?'No account yet? ':'Already have an account? '}
          <button onClick={()=>{setMode(mode==='login'?'register':'login');setError('');}}
            style={{background:'none',border:'none',cursor:'pointer',color:'var(--terracotta)',fontWeight:700,fontSize:12,textDecoration:'underline'}}>
            {mode==='login'?'Register here':'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════ */
export default function Home() {
  const [ingredients,setIngredients]=useState<IngredientRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [result,setResult]=useState<SearchResult|null>(null);
  // allResults holds the full unfiltered+unpaged list for client-side pagination
  const [allResults,setAllResults]=useState<Recipe[]>([]);
  const [currentPage,setCurrentPage]=useState(1);
  const [modalRecipe,setModalRecipe]=useState<Recipe|null>(null);
  const [savedRecipes,setSavedRecipes]=useState<Recipe[]>([]);
  const [savedIds,setSavedIds]=useState<Set<string>>(new Set());
  const [flyingItems,setFlyingItems]=useState<FlyingItem[]>([]);
  const [isStirring,setIsStirring]=useState(false);
  const [lastAdded,setLastAdded]=useState<string|null>(null);
  const [activeTab,setActiveTab]=useState<'search'|'saved'|'myrecipes'>('search');
  const [soundOn,setSoundOn]=useState(false);
  const [vegFilter,setVegFilter]=useState<'all'|'veg'|'nonveg'>('all');
  const [currentUser,setCurrentUser]=useState<AuthUser|null>(null);
  const [showAuth,setShowAuth]=useState(false);
  const stirTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const RECIPES_PER_PAGE = 6;

  // Load user from localStorage on mount
  useEffect(()=>{
    try {
      const stored = localStorage.getItem('chefai_user');
      const token = localStorage.getItem('chefai_token');
      if(stored && token) setCurrentUser(JSON.parse(stored));
    } catch {}
  },[]);

  useEffect(()=>{
    getSavedRecipes().then(data=>{
      setSavedRecipes(data);
      setSavedIds(new Set(data.map((r:Recipe)=>r._id).filter(Boolean)));
    }).catch(()=>{});
  },[currentUser]);

  // ── SSE listener — receive real-time recipe events from backend ──
  useEffect(()=>{
    const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
    const es = new EventSource(`${API}/recipes/events`);

    es.onmessage = (e) => {
      try {
        const ev: { type: 'deleted'|'updated'; recipeId: string } = JSON.parse(e.data);

        if (ev.type === 'deleted') {
          const id = ev.recipeId;
          // Remove from search results (all-results cache + visible page)
          setAllResults(prev => prev.filter(r => r._id !== id));
          setResult(prev => {
            if (!prev) return null;
            const newRecipes = prev.recipes.filter(r => r._id !== id);
            return { ...prev, recipes: newRecipes, totalFound: Math.max(0, prev.totalFound - 1) };
          });
          // Remove from saved
          setSavedRecipes(prev => prev.filter(r => r._id !== id));
          setSavedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
          // Close modal if open
          setModalRecipe(prev => prev?._id === id ? null : prev);
          toast(`A community recipe was removed`, { icon: '🗑️', duration: 3000 });
        }

        if (ev.type === 'updated') {
          // Just re-fetch saved if the updated recipe was saved
          getSavedRecipes().then(data => {
            setSavedRecipes(data);
            setSavedIds(new Set(data.map((r:Recipe)=>r._id).filter(Boolean)));
          }).catch(()=>{});
        }
      } catch {}
    };

    es.onerror = () => { /* reconnects automatically */ };
    return () => es.close();
  }, []);

  const handleAuthSuccess = (token: string, user: AuthUser) => {
    localStorage.setItem('chefai_token', token);
    localStorage.setItem('chefai_user', JSON.stringify(user));
    setCurrentUser(user);
    setShowAuth(false);
    toast.success(`Welcome, ${user.name}! 🎉`);
  };

  const handleLogout = () => {
    localStorage.removeItem('chefai_token');
    localStorage.removeItem('chefai_user');
    setCurrentUser(null);
    setSavedRecipes([]);
    setSavedIds(new Set());
    toast('Logged out 👋');
  };

  const toggleSound=()=>{
    if(!sounds)return;
    const on=sounds.toggle();
    setSoundOn(on);
    toast(on?'🔊 Kitchen sounds on — turn up the volume!':'🔇 Sounds off',{duration:2000});
  };

  const addIngredient=useCallback(()=>{
    setIngredients(p=>[...p,{id:mkId(),name:'',quantity:'1',unit:'pieces'}]);
  },[]);

  const removeIngredient=useCallback((id:string)=>{
    setIngredients(p=>p.filter(i=>i.id!==id));
  },[]);

  const updateIngredient=useCallback((id:string,field:keyof IngredientInput,val:string)=>{
    setIngredients(p=>p.map(i=>i.id===id?{...i,[field]:val}:i));
  },[]);

  const addIngredientToList=useCallback((ing:{name:string,unit:string},btnEl:HTMLElement)=>{
    setIngredients(prev=>{
      if(prev.some(i=>i.name.toLowerCase()===ing.name.toLowerCase())){
        toast(`${ing.name} already in the pot!`,{icon:'⚠️'});return prev;
      }
      // Flying emoji
      const rect=btnEl.getBoundingClientRect();
      const potEl=document.getElementById('pot-target');
      const potRect=potEl?.getBoundingClientRect();
      if(potRect){
        const id=mkId();
        const item:FlyingItem={id,emoji:getEmoji(ing.name),
          x:rect.left+rect.width/2-13, y:rect.top+window.scrollY-13,
          tx:(potRect.left+potRect.width/2)-(rect.left+rect.width/2),
          ty:(potRect.top+window.scrollY+potRect.height*0.45)-(rect.top+window.scrollY),
        };
        setFlyingItems(p=>[...p,item]);
        setTimeout(()=>setFlyingItems(p=>p.filter(f=>f.id!==id)),950);
      }
      // Stir
      if(stirTimerRef.current)clearTimeout(stirTimerRef.current);
      setIsStirring(true);
      stirTimerRef.current=setTimeout(()=>setIsStirring(false),2200);
      // Sounds
      sounds?.playSplash();
      setTimeout(()=>sounds?.playStir(),250);
      const newRow:IngredientRow={id:mkId(),name:ing.name,quantity:'1',unit:ing.unit};
      setLastAdded(newRow.id);
      setTimeout(()=>setLastAdded(null),800);
      return[...prev,newRow];
    });
  },[]);

  const doSearch=useCallback(async(page=1)=>{
    const valid=ingredients.filter(i=>i.name.trim());
    if(!valid.length){toast.error('Add at least one ingredient!');return;}
    setLoading(true);
    if(page===1){
      setResult(null);
      setAllResults([]);
      setCurrentPage(1);
      setVegFilter('all');
    }
    sounds?.playBoilUp();
    try{
      // Always fetch page 1 from backend which returns ALL results; we paginate client-side
      const data=await searchRecipes(valid.map(({name,quantity,unit})=>({name,quantity,unit})),1);
      // Store the full result set for client-side pagination
      setAllResults(data.recipes);
      setResult(data);
      setCurrentPage(1);
      if(page===1)setTimeout(()=>document.getElementById('results')?.scrollIntoView({behavior:'smooth'}),100);
    }catch(e:any){toast.error(e.response?.data?.message||'Search failed — is the backend running?');}
    finally{setLoading(false);}
  },[ingredients]);

  const handleSave=useCallback(async(recipe:Recipe)=>{
    if(!currentUser){setShowAuth(true);toast('Login to save recipes!',{icon:'🔒'});return;}
    if(recipe._id&&savedIds.has(recipe._id)){toast('Already saved!',{icon:'🔖'});return;}
    try{
      const saved=await saveRecipe({...recipe,isSaved:true,isUserCreated:false});
      const savedId = saved._id || (saved as any).insertedId;
      const newLikes = (saved.savedByUserIds?.length) ?? 1;
      setSavedRecipes(p=>[{...saved,_id:savedId},...p.filter(r=>r._id!==savedId)]);
      setSavedIds(p=>new Set([...p,savedId]));
      const updater = (r:Recipe) => r.title===recipe.title ? {...r,_id:savedId,isSaved:true,likes:newLikes,savedByUserIds:[...(r.savedByUserIds||[]),currentUser.id]} : r;
      setResult(prev=>prev?{...prev,recipes:prev.recipes.map(updater)}:null);
      setAllResults(prev=>prev.map(updater));
      toast.success('Recipe saved! 🔖');
    }catch{toast.error('Failed to save');}
  },[savedIds,currentUser]);

  const handleUnsave=useCallback(async(id:string)=>{
    try{
      await unsaveRecipe(id);
      setSavedRecipes(p=>p.filter(r=>r._id!==id));
      setSavedIds(p=>{const n=new Set(p);n.delete(id);return n;});
      const updater = (r:Recipe) => r._id===id ? {...r,isSaved:false,likes:Math.max((r.likes||1)-1,0),savedByUserIds:(r.savedByUserIds||[]).filter(uid=>uid!==currentUser?.id)} : r;
      setResult(prev=>prev?{...prev,recipes:prev.recipes.map(updater)}:null);
      setAllResults(prev=>prev.map(updater));
      toast('Removed from saved',{icon:'🗑️'});
    }catch{toast.error('Failed to remove');}
  },[currentUser]);

  // Client-side veg filter applied to full result set
  const vegFiltered = allResults.filter(r => {
    if (vegFilter === 'veg') return r.isVegetarian === true;
    if (vegFilter === 'nonveg') return r.isVegetarian === false;
    return true;
  });

  // Client-side pagination on the filtered set
  const totalFiltered = vegFiltered.length;
  const totalPages = Math.ceil(totalFiltered / RECIPES_PER_PAGE);
  const safePage = Math.min(Math.max(1, currentPage), totalPages || 1);
  const filteredRecipes = vegFiltered.slice((safePage - 1) * RECIPES_PER_PAGE, safePage * RECIPES_PER_PAGE);

  const goToPage = (pg: number) => {
    const p = Math.min(Math.max(1, pg), totalPages);
    setCurrentPage(p);
    setTimeout(()=>document.getElementById('results')?.scrollIntoView({behavior:'smooth'}),50);
  };

  const validCount=ingredients.filter(i=>i.name.trim()).length;

  return(
    <>
      <Head>
        <title>ChefAI — Recipe Finder</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🫕</text></svg>"/>
      </Head>

      {/* page wrapper — flex column, min full height */}
      <div style={{display:'flex',flexDirection:'column',minHeight:'100vh'}}>

        <FlyingEmojis items={flyingItems}/>
        {showAuth && <AuthModal onClose={()=>setShowAuth(false)} onSuccess={handleAuthSuccess}/>}

        {/* ── Navbar ── */}
        <nav style={{position:'sticky',top:0,zIndex:50,background:'rgba(253,246,236,0.96)',backdropFilter:'blur(20px)',borderBottom:'1px solid rgba(135,168,120,0.18)',flexShrink:0}}>
          <div style={{maxWidth:1100,margin:'0 auto',padding:'10px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
            {/* Logo */}
            <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
              <div style={{width:38,height:38,borderRadius:11,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,background:'linear-gradient(135deg,#C1683A,#E08055)'}}>🫕</div>
              <div>
                <h1 style={{fontFamily:'Lora,serif',fontWeight:700,fontSize:17,color:'var(--text-dark)',lineHeight:1}}>Chef<span style={{color:'var(--terracotta)'}}>AI</span></h1>
                <p style={{fontSize:10,color:'var(--text-light)'}}>Recipe Finder</p>
              </div>
            </div>

            {/* Tabs */}
            <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
              {([
                ['search','🔍','Search'],
                ['saved','🔖','Saved'],
                ['myrecipes','👨‍🍳','My Recipes'],
              ] as const).map(([tab,icon,label])=>(
                <button key={tab} onClick={()=>setActiveTab(tab)} style={{
                  padding:'7px 13px',borderRadius:11,fontSize:12,fontWeight:600,border:'none',cursor:'pointer',
                  background:activeTab===tab?(tab==='search'?'var(--terracotta)':tab==='saved'?'var(--sage)':'#5C6BC0'):'transparent',
                  color:activeTab===tab?'white':'var(--text-mid)',position:'relative',transition:'all 0.2s',whiteSpace:'nowrap',
                }}>
                  {icon} {label}
                  {tab==='saved'&&savedRecipes.length>0&&(
                    <span style={{position:'absolute',top:-4,right:-4,width:16,height:16,borderRadius:'50%',
                      background:'var(--terracotta)',color:'white',fontSize:9,fontWeight:700,
                      display:'flex',alignItems:'center',justifyContent:'center'}}>{savedRecipes.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Right controls */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
              <button onClick={toggleSound} title="Toggle kitchen sounds" style={{
                width:34,height:34,borderRadius:9,border:'1.5px solid var(--border)',
                background:soundOn?'#EEF5EB':'white',cursor:'pointer',fontSize:16,
                display:'flex',alignItems:'center',justifyContent:'center',
              }}>{soundOn?'🔊':'🔇'}</button>

              {currentUser ? (
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',borderRadius:10,background:'#EEF5EB'}}>
                    <div style={{width:24,height:24,borderRadius:'50%',background:'linear-gradient(135deg,var(--sage),var(--terracotta))',
                      display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontSize:11,fontWeight:700,flexShrink:0}}>
                      {currentUser.name.charAt(0).toUpperCase()}
                    </div>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--sage-dark)',maxWidth:80,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{currentUser.name}</span>
                  </div>
                  <button onClick={handleLogout} style={{
                    padding:'5px 10px',borderRadius:9,fontSize:11,fontWeight:600,
                    border:'1.5px solid #ddd',background:'white',cursor:'pointer',color:'var(--text-mid)'
                  }}>Logout</button>
                </div>
              ) : (
                <button onClick={()=>setShowAuth(true)} style={{
                  padding:'7px 14px',borderRadius:11,fontSize:12,fontWeight:700,
                  background:'var(--terracotta)',color:'white',border:'none',cursor:'pointer',
                  boxShadow:'0 2px 8px rgba(193,104,58,0.3)',
                }}>🔑 Login</button>
              )}
            </div>
          </div>
        </nav>

        {/* ── Main content — grows to fill space ── */}
        <main style={{flex:'1 0 auto',maxWidth:1100,width:'100%',margin:'0 auto',padding:'28px 20px 48px',boxSizing:'border-box'}}>

          {/* ─── SEARCH TAB ─── */}
          {activeTab==='search'&&(
            <>
              <div style={{textAlign:'center',paddingBottom:24}}>
                <div style={{fontSize:56,display:'inline-block',marginBottom:8,animation:'float 3s ease-in-out infinite'}}>🫕</div>
                <h1 style={{fontFamily:'Lora,serif',fontWeight:900,fontSize:'clamp(1.6rem,5vw,3.4rem)',color:'var(--text-dark)',lineHeight:1.2,marginBottom:8}}>
                  What's in your <span style={{color:'var(--terracotta)'}}>kitchen?</span>
                </h1>
                <p style={{fontSize:15,color:'var(--text-mid)',maxWidth:500,margin:'0 auto'}}>
                  Toss ingredients into the pot — we'll crawl the web for real recipes.
                </p>
              </div>

              <div id="cooking-pot">
                <PotSection ingredients={ingredients} onAdd={addIngredient} onRemove={removeIngredient}
                  onUpdate={updateIngredient} onAddIngredient={addIngredientToList}
                  isStirring={isStirring} lastAdded={lastAdded}/>
              </div>

              <button onClick={()=>doSearch(1)} disabled={loading||validCount===0} style={{
                width:'100%',padding:'16px',borderRadius:18,fontWeight:700,fontSize:16,
                color:'white',border:'none',cursor:validCount>0?'pointer':'not-allowed',
                background:validCount>0?'linear-gradient(135deg,var(--terracotta),#E08055)':'#DDD',
                boxShadow:validCount>0?'0 8px 28px rgba(193,104,58,0.3)':'none',
                transition:'all 0.3s',opacity:loading||validCount===0?0.7:1,marginBottom:24,
              }}>
                {loading
                  ?<span style={{display:'flex',alignItems:'center',justifyContent:'center',gap:10}}>
                    <span style={{width:17,height:17,border:'2.5px solid white',borderTopColor:'transparent',borderRadius:'50%',display:'inline-block',animation:'spin 0.8s linear infinite'}}/>
                    Crawling the web for recipes…
                  </span>
                  :`🔍 Find Recipes${validCount>0?` with ${validCount} ingredient${validCount>1?'s':''}`:''}`
                }
              </button>

              {result&&(
                <div id="results">
                  {/* ── Results header ── */}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10,
                    padding:'12px 16px',borderRadius:16,background:'white',border:'1.5px solid var(--border)',marginBottom:16}}>
                    <div>
                      <h2 style={{fontFamily:'Lora,serif',fontSize:16,fontWeight:700,color:'var(--text-dark)'}}>
                        {allResults.length === 0 ? '😔 No Recipes Found' : `🌐 ${totalFiltered} Recipe${totalFiltered!==1?'s':''} Found`}
                      </h2>
                      <p style={{fontSize:11,color:'var(--text-light)',marginTop:1}}>
                        {allResults.length > 0
                          ? `"${result.query}" · Page ${safePage} of ${totalPages} · ${RECIPES_PER_PAGE} per page`
                          : `No results for: ${result.query}`}
                      </p>
                    </div>
                    {allResults.length > 0 && (
                      <div style={{display:'flex',gap:3,padding:'3px',borderRadius:11,background:'#F5F0E8'}}>
                        {([
                          ['all','🍽️ All', allResults.length] as const,
                          ['veg','🌿 Veg', allResults.filter(r=>r.isVegetarian).length] as const,
                          ['nonveg','🍖 Non-Veg', allResults.filter(r=>r.isVegetarian===false).length] as const,
                        ]).map(([val,label,cnt])=>(
                          <button key={val} onClick={()=>{setVegFilter(val as any);setCurrentPage(1);}} style={{
                            padding:'5px 10px',borderRadius:8,fontSize:11,fontWeight:600,border:'none',cursor:'pointer',transition:'all 0.18s',
                            background:vegFilter===val?(val==='veg'?'#2E7D32':val==='nonveg'?'#C62828':'var(--terracotta)'):'transparent',
                            color:vegFilter===val?'white':'var(--text-mid)',
                          }}>{label} <span style={{opacity:0.65,fontSize:10}}>({cnt})</span></button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── Zero results across all sites ── */}
                  {allResults.length === 0 && (
                    <div style={{textAlign:'center',padding:'56px 20px',borderRadius:20,background:'white',border:'1.5px solid var(--border)'}}>
                      <div style={{fontSize:56,marginBottom:12}}>🔍</div>
                      <h3 style={{fontFamily:'Lora,serif',fontSize:20,fontWeight:700,color:'var(--text-dark)',marginBottom:8}}>No recipes found</h3>
                      <p style={{fontSize:14,color:'var(--text-mid)',maxWidth:420,margin:'0 auto 18px'}}>
                        We searched <strong>12 recipe websites</strong> for <em>"{result.query}"</em> but found nothing. Try simpler or different ingredient names.
                      </p>
                      <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'center',marginBottom:20}}>
                        {['AllRecipes','BBC Good Food','Food.com','Epicurious','Simply Recipes','Tasty','Delish','Serious Eats','Yummly','Cookie & Kate','Minimalist Baker','Love & Lemons'].map(s=>(
                          <span key={s} style={{padding:'3px 9px',borderRadius:20,fontSize:11,background:'#F5F0E8',color:'var(--text-mid)'}}>{s}</span>
                        ))}
                      </div>
                      <button onClick={()=>doSearch(1)} style={{padding:'10px 24px',borderRadius:12,background:'var(--terracotta)',color:'white',fontWeight:700,border:'none',cursor:'pointer',fontSize:14}}>
                        🔄 Try Again
                      </button>
                    </div>
                  )}

                  {/* ── Veg filter has no matches but all-results has some ── */}
                  {allResults.length > 0 && filteredRecipes.length === 0 && (
                    <div style={{textAlign:'center',padding:'44px 0',color:'var(--text-light)'}}>
                      <p style={{fontSize:36,marginBottom:8}}>{vegFilter==='veg'?'🌿':'🍖'}</p>
                      <p style={{fontSize:15,fontWeight:600}}>No {vegFilter==='veg'?'vegetarian':'non-vegetarian'} recipes found</p>
                      <button onClick={()=>{setVegFilter('all');setCurrentPage(1);}} style={{marginTop:12,padding:'8px 18px',borderRadius:9,background:'var(--terracotta)',color:'white',border:'none',cursor:'pointer',fontWeight:600}}>
                        Show All Recipes
                      </button>
                    </div>
                  )}

                  {/* ── Recipe grid ── */}
                  {filteredRecipes.length > 0 && (
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(265px,1fr))',gap:16,marginBottom:20}}>
                      {filteredRecipes.map((recipe,i)=>(
                        <RecipeCard key={`${recipe.title}-${safePage}-${i}`} recipe={recipe} index={i}
                          onClick={()=>setModalRecipe(recipe)} onSave={handleSave} onUnsave={handleUnsave} savedIds={savedIds}/>
                      ))}
                    </div>
                  )}

                  {/* ── Pagination — purely based on filtered count ── */}
                  {totalPages > 1 && filteredRecipes.length > 0 && (
                    <>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:5,flexWrap:'wrap'}}>
                        <button onClick={()=>goToPage(safePage-1)} disabled={safePage<=1} className="page-btn" style={{opacity:safePage<=1?0.3:1}}>←</button>
                        {(()=>{
                          const pages:(number|'...')[] = [];
                          for(let p=1;p<=totalPages;p++){
                            if(p===1||p===totalPages||(p>=safePage-2&&p<=safePage+2)) pages.push(p);
                            else if(pages[pages.length-1]!=='...') pages.push('...');
                          }
                          return pages.map((p,idx)=> p==='...'
                            ? <span key={`e${idx}`} style={{padding:'0 4px',color:'var(--text-light)',fontSize:14}}>…</span>
                            : <button key={p} onClick={()=>goToPage(p as number)} className={`page-btn${p===safePage?' active':''}`}>{p}</button>
                          );
                        })()}
                        <button onClick={()=>goToPage(safePage+1)} disabled={safePage>=totalPages} className="page-btn" style={{opacity:safePage>=totalPages?0.3:1}}>→</button>
                      </div>
                      <p style={{textAlign:'center',fontSize:11,color:'var(--text-light)',marginTop:8}}>
                        Showing {(safePage-1)*RECIPES_PER_PAGE+1}–{Math.min(safePage*RECIPES_PER_PAGE,totalFiltered)} of {totalFiltered} recipes
                      </p>
                    </>
                  )}
                </div>
              )}

              {!loading&&!result&&(
                <div style={{textAlign:'center',padding:'40px 0',color:'var(--text-light)'}}>
                  <p style={{fontSize:44,marginBottom:8}}>👆</p>
                  <p style={{fontSize:16,fontWeight:600}}>Add ingredients above to get started</p>
                  <p style={{fontSize:12,marginTop:4}}>Searches 12 sites: AllRecipes, BBC Good Food, Epicurious, Tasty & more</p>
                </div>
              )}
            </>
          )}

          {/* ─── SAVED TAB ─── */}
          {activeTab==='saved'&&(
            <SavedPanel savedRecipes={savedRecipes} onOpen={setModalRecipe}
              onUnsave={handleUnsave} savedIds={savedIds}/>
          )}

          {/* ─── MY RECIPES TAB ─── */}
          {activeTab==='myrecipes'&&(
            <MyRecipesPanel currentUser={currentUser} onOpen={setModalRecipe} onLogin={()=>setShowAuth(true)}/>
          )}

        </main>

        {/* ── Footer — always at bottom ── */}
        <footer style={{
          flexShrink:0,
          background:'linear-gradient(135deg,#1a1208,#2d1e0f)',
          color:'white',padding:'28px 20px',
          borderTop:'3px solid var(--terracotta)',
        }}>
          <div style={{maxWidth:1100,margin:'0 auto',display:'flex',flexDirection:'column',alignItems:'center',gap:8}}>
            <div style={{fontSize:28}}>🫕</div>
            <h2 style={{fontFamily:'Lora,serif',fontSize:16,fontWeight:700}}>Chef<span style={{color:'#E08055'}}>AI</span></h2>
            <p style={{fontSize:12,color:'rgba(255,255,255,0.45)',textAlign:'center',maxWidth:340}}>
              Real recipes from across the web. Powered by web crawling &amp; Google Gemini AI.
            </p>
            <div style={{height:1,width:'100%',maxWidth:260,background:'rgba(255,255,255,0.08)',margin:'4px 0'}}/>
            <p style={{
              fontSize:15,fontWeight:700,
              background:'linear-gradient(90deg,#F4A261,#E76F51)',
              WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',
              letterSpacing:'0.02em',
            }}>
              ✨ Created by Shreya Dhoke
            </p>
            <p style={{fontSize:10,color:'rgba(255,255,255,0.2)',marginTop:2}}>© {new Date().getFullYear()} ChefAI · All rights reserved</p>
          </div>
        </footer>

      </div>{/* end page wrapper */}

      {modalRecipe&&<RecipeModal recipe={modalRecipe} onClose={()=>setModalRecipe(null)}
        onSave={handleSave} onUnsave={handleUnsave} savedIds={savedIds} currentUser={currentUser}/>}

      <style jsx global>{`
        html, body { margin:0; padding:0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes fly-to-pot {
          0%   { opacity:1; transform:translate(0,0) scale(1) rotate(0deg); }
          50%  { opacity:1; transform:translate(calc(var(--tx)*0.7),calc(var(--ty)*0.5)) scale(1.3) rotate(180deg); }
          85%  { opacity:0.8; transform:translate(calc(var(--tx)*0.95),calc(var(--ty)*0.95)) scale(0.6) rotate(320deg); }
          100% { opacity:0; transform:translate(var(--tx),var(--ty)) scale(0.2) rotate(360deg); }
        }
        .animate-fade-up { animation: fadeUp 0.3s ease forwards; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        .card-img:hover { transform: scale(1.05); }
        @keyframes modalIn { from{opacity:0;transform:scale(0.95) translateY(16px)} to{opacity:1;transform:scale(1) translateY(0)} }
      `}</style>
    </>
  );
}
