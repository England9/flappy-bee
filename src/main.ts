import './style.css'
import { sfx, unlockAudio } from './audio'

declare global {
  interface Window {
    __flappyBee: {
      state: () => {
        mode: string
        beeY: number
        beeVy: number
        score: number
        pipes: number
        honey: number
        flowers: number
      }
    }
  }
}

const GINZA_SITE = 'https://gin-pachi.jp'
const GINZA_DONATE = 'https://syncable.biz/associate/ginpachi/donate'
const BEST_KEY = 'flappy-bee-best'

const PIPE_POINTS = 1
const HONEY_POINTS = 5
const FLOWER_POINTS = 3

type Mode = 'start' | 'ready' | 'playing' | 'dead'
type PickupKind = 'honey' | 'flower'

interface Pipe {
  x: number
  gapY: number
  /** Vertical opening height (varies per pipe). */
  gap: number
  scored: boolean
}

interface Pickup {
  kind: PickupKind
  x: number
  y: number
  bob: number
  taken: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  size: number
  color: string
}

interface FloatText {
  x: number
  y: number
  text: string
  life: number
  color: string
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <div class="stage" id="stage">
    <canvas id="game" width="420" height="700" aria-label="Flappy Bee game"></canvas>
    <div class="hud">
      <div class="brand">
        <h1>Flappy Bee</h1>
        <p>for Ginza Honey Bee Project</p>
      </div>
      <div class="score-wrap hidden" id="scoreWrap">
        <div class="score" id="score">0</div>
        <div class="score-meta" id="scoreMeta">Honey 0 · Flowers 0</div>
      </div>
      <div class="hint hidden" id="hint">Tap or press Space to fly</div>
    </div>
    <div class="overlay visible" id="overlay" aria-live="polite">
      <div class="panel" id="panel"></div>
    </div>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!
const scoreEl = document.querySelector<HTMLDivElement>('#score')!
const scoreWrapEl = document.querySelector<HTMLDivElement>('#scoreWrap')!
const scoreMetaEl = document.querySelector<HTMLDivElement>('#scoreMeta')!
const hintEl = document.querySelector<HTMLDivElement>('#hint')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const W = canvas.width
const H = canvas.height
const GROUND = 84
const BEE_X = W * 0.28
const BEE_R = 22
const PIPE_W = 72
const GAP_MIN = 155
const GAP_MAX = 225
const PIPE_SPEED = 2.15
const GRAVITY = 0.28
const FLAP = -6.2
const MAX_FALL = 8.5
/** Horizontal gap between pipe columns, in world px (varies). */
const SPACING_MIN = 175
const SPACING_MAX = 360
/** Below this spacing, bonuses must sit inside the pipe opening. */
const SHORT_SPACING = 240
const FIRST_PIPE_MS = 2100
const PICKUP_CHANCE = 0.42
const PICKUP_R = 16

let mode: Mode = 'start'
let beeY = H * 0.45
let beeVy = 0
let beeRot = 0
let wingPhase = 0
let spawnTimer = 0
let nextSpawnMs = FIRST_PIPE_MS
let lastSpacingPx = 260
let lastPipe: Pipe | null = null
let groundScroll = 0
let pipes: Pipe[] = []
let pickups: Pickup[] = []
let particles: Particle[] = []
let floatTexts: FloatText[] = []
let score = 0
let pipesPassed = 0
let honeyGot = 0
let flowersGot = 0
let best = Number(localStorage.getItem(BEST_KEY) || 0) || 0
let clouds = createClouds()
let groundBlooms = createGroundBlooms()
let lastTs = 0
let animId = 0

function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}

/** Convert a horizontal spacing (px) into spawn delay (ms) at current pipe speed. */
function spacingToMs(spacingPx: number) {
  // PIPE_SPEED is per 60fps frame; distance/frame ≈ PIPE_SPEED
  const frames = spacingPx / PIPE_SPEED
  return frames * (1000 / 60)
}

function createClouds() {
  return Array.from({ length: 5 }, (_, i) => ({
    x: (i * 110 + 40) % (W + 120),
    y: 40 + (i % 3) * 48,
    s: 0.55 + (i % 3) * 0.2,
    speed: 0.18 + (i % 4) * 0.06,
  }))
}

function createGroundBlooms() {
  return Array.from({ length: 9 }, (_, i) => ({
    x: 20 + i * 48,
    bob: Math.random() * Math.PI * 2,
    hue: 28 + (i % 4) * 18,
  }))
}

function beeMarkHtml() {
  return `
    <div class="emoji-bee" aria-hidden="true">
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
        <ellipse cx="32" cy="36" rx="16" ry="12" fill="#F5C542"/>
        <path d="M20 32h24M20 38h24M20 44h24" stroke="#2A2118" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="44" cy="28" r="8" fill="#2A2118"/>
        <circle cx="47" cy="26" r="2.2" fill="#fff"/>
        <ellipse cx="22" cy="24" rx="10" ry="7" fill="#B8E4FF" fill-opacity=".85" transform="rotate(-18 22 24)"/>
      </svg>
    </div>`
}

function updateScoreHud() {
  scoreEl.textContent = String(score)
  scoreMetaEl.textContent = `Honey ${honeyGot} · Flowers ${flowersGot}`
}

function bumpScore() {
  scoreEl.classList.remove('bump')
  void scoreEl.offsetWidth
  scoreEl.classList.add('bump')
}

function addScore(points: number, x: number, y: number, label: string, color: string) {
  score += points
  updateScoreHud()
  bumpScore()
  floatTexts.push({ x, y, text: label, life: 1, color })
}

function showStartScreen() {
  mode = 'start'
  scoreWrapEl.classList.add('hidden')
  hintEl.classList.add('hidden')
  panelEl.innerHTML = `
    ${beeMarkHtml()}
    <h2>Flappy Bee</h2>
    <p class="lead">
      Fly through leafy gaps. Grab <strong>honey (+${HONEY_POINTS})</strong>
      and <strong>flowers (+${FLOWER_POINTS})</strong> for bonus points.
      Pipes are worth +${PIPE_POINTS}.
    </p>
    <ul class="howto">
      <li>Tap / Space / ↑ to flap</li>
      <li>Collect glowing honey &amp; blossoms</li>
      <li>How long can your hive score go?</li>
    </ul>
    ${best > 0 ? `<p class="best">Best score: <strong>${best}</strong></p>` : ''}
    <div class="actions">
      <button type="button" class="btn btn-primary" data-action="play">Play</button>
    </div>
    <p class="win-note">Tribute to the Ginza Honey Bee Project</p>
  `
  overlayEl.classList.add('visible')
}

function goToReady() {
  unlockAudio()
  sfx.start()
  mode = 'ready'
  beeY = H * 0.45
  beeVy = 0
  beeRot = 0
  wingPhase = 0
  spawnTimer = 0
  nextSpawnMs = FIRST_PIPE_MS
  lastSpacingPx = 260
  lastPipe = null
  groundScroll = 0
  pipes = []
  pickups = []
  particles = []
  floatTexts = []
  score = 0
  pipesPassed = 0
  honeyGot = 0
  flowersGot = 0
  updateScoreHud()
  scoreWrapEl.classList.add('hidden')
  scoreEl.classList.remove('bump')
  hintEl.classList.remove('hidden')
  hideOverlay()
}

function startPlaying() {
  if (mode === 'playing') return
  mode = 'playing'
  beeVy = FLAP
  spawnTimer = 0
  nextSpawnMs = FIRST_PIPE_MS
  lastPipe = null
  hintEl.classList.add('hidden')
  scoreWrapEl.classList.remove('hidden')
  hideOverlay()
  sfx.flap()
  spawnBurst(BEE_X, beeY, '#ffe08a')
}

function flap() {
  if (mode === 'start' || mode === 'dead') return
  if (mode === 'ready') {
    startPlaying()
    return
  }
  if (mode === 'playing') {
    beeVy = FLAP
    sfx.flap()
    spawnBurst(BEE_X - 6, beeY + 8, '#fff3c4')
  }
}

function spawnBurst(x: number, y: number, color: string) {
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 0.8 + Math.random() * 2.2
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1,
      life: 1,
      size: 2 + Math.random() * 3,
      color,
    })
  }
}

function randomGapSize() {
  return rand(GAP_MIN, GAP_MAX)
}

function randomGapY(gap: number, preferNear?: number) {
  const margin = 95
  const minY = margin
  const maxY = H - GROUND - gap - margin
  if (maxY <= minY) return minY
  let y = rand(minY, maxY)
  // Softly pull toward previous gap so height changes, but stays flyable
  if (preferNear != null) {
    const maxJump = 130
    y = Math.max(minY, Math.min(maxY, preferNear + rand(-maxJump, maxJump)))
  }
  return y
}

function maybeSpawnBonus(pipe: Pipe, spacingPx: number) {
  if (Math.random() > PICKUP_CHANCE) return

  const kind: PickupKind = Math.random() < 0.35 ? 'honey' : 'flower'
  const pad = PICKUP_R + BEE_R * 0.35
  let x: number
  let y: number

  if (spacingPx < SHORT_SPACING) {
    // Tight run — keep the bonus inside this pipe's opening so it's reachable
    x = pipe.x + PIPE_W * 0.5 + rand(-8, 8)
    const top = pipe.gapY + pad
    const bot = pipe.gapY + pipe.gap - pad
    y = top < bot ? rand(top, bot) : pipe.gapY + pipe.gap * 0.5
  } else {
    // Wide run — place somewhere in the open stretch; often high, still clear of pipes
    const prevRight = lastPipe ? lastPipe.x + PIPE_W : pipe.x - spacingPx
    const openLeft = prevRight + 28
    const openRight = pipe.x - 28
    x = openLeft < openRight ? rand(openLeft, openRight) : pipe.x - spacingPx * 0.45

    // Prefer the upper sky on long gaps, but stay below the ceiling / above ground
    const highTop = 70
    const highBot = Math.min(H * 0.38, pipe.gapY + pipe.gap * 0.35)
    if (Math.random() < 0.7 && highBot > highTop + 20) {
      y = rand(highTop, highBot)
    } else {
      // Alternate: mid-corridor between previous & current openings
      const midA = lastPipe ? lastPipe.gapY + lastPipe.gap * 0.5 : H * 0.4
      const midB = pipe.gapY + pipe.gap * 0.5
      y = (midA + midB) * 0.5 + rand(-36, 36)
      y = Math.max(70, Math.min(H - GROUND - 50, y))
    }
  }

  pickups.push({
    kind,
    x,
    y,
    bob: Math.random() * Math.PI * 2,
    taken: false,
  })
}

function spawnPipe() {
  const gap = randomGapSize()
  const gapY = randomGapY(gap, lastPipe?.gapY)
  const pipe: Pipe = { x: W + 20, gapY, gap, scored: false }
  pipes.push(pipe)

  // Spacing used for the stretch leading into this pipe
  maybeSpawnBonus(pipe, lastSpacingPx)
  lastPipe = pipe

  // Roll the next horizontal gap (varies distance between pipes)
  lastSpacingPx = rand(SPACING_MIN, SPACING_MAX)
  nextSpawnMs = spacingToMs(lastSpacingPx)
}

function hideOverlay() {
  overlayEl.classList.remove('visible')
}

function die() {
  mode = 'dead'
  sfx.die()
  spawnBurst(BEE_X, beeY, '#ffb4a2')
  if (score > best) {
    best = score
    localStorage.setItem(BEST_KEY, String(best))
  }
  showDeathDonation()
}

function showDeathDonation() {
  panelEl.innerHTML = `
    ${beeMarkHtml()}
    <h2>Game over</h2>
    <p class="score-big">Score <strong>${score}</strong></p>
    <p class="breakdown">
      Pipes ×${pipesPassed} (+${pipesPassed * PIPE_POINTS}) ·
      Honey ×${honeyGot} (+${honeyGot * HONEY_POINTS}) ·
      Flowers ×${flowersGot} (+${flowersGot * FLOWER_POINTS})
      ${best > 0 ? `<br/>Best: <strong>${best}</strong>` : ''}
    </p>
    <p>
      Please support the <strong>Ginza Honey Bee Project</strong> —
      Tokyo’s urban beekeeping NPO connecting people, city, and nature.
    </p>
    <div class="actions">
      <a class="btn btn-primary" href="${GINZA_DONATE}" target="_blank" rel="noopener noreferrer">
        Support the project
      </a>
      <a class="btn btn-secondary" href="${GINZA_SITE}" target="_blank" rel="noopener noreferrer">
        Visit gin-pachi.jp
      </a>
      <button type="button" class="btn btn-ghost" data-action="again">Play again</button>
      <button type="button" class="btn btn-ghost" data-action="menu">Back to start</button>
    </div>
    <p class="win-note">Unofficial tribute game · not affiliated with the NPO</p>
  `
  overlayEl.classList.add('visible')
}

function update(dt: number) {
  const t = Math.min(dt, 32) / (1000 / 60)

  wingPhase += t * 0.45
  for (const c of clouds) {
    c.x -= c.speed * t
    if (c.x < -100) c.x = W + 60
  }
  for (const f of groundBlooms) f.bob += t * 0.065
  if (mode === 'playing' || mode === 'ready') {
    groundScroll = (groundScroll + PIPE_SPEED * t * (mode === 'playing' ? 1 : 0.35)) % (W + 40)
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx * t
    p.y += p.vy * t
    p.vy += 0.08 * t
    p.life -= t * 0.03
    if (p.life <= 0) particles.splice(i, 1)
  }

  for (let i = floatTexts.length - 1; i >= 0; i--) {
    const f = floatTexts[i]
    f.y -= 0.7 * t
    f.life -= t * 0.025
    if (f.life <= 0) floatTexts.splice(i, 1)
  }

  if (mode === 'start' || mode === 'ready') {
    beeY = H * 0.45 + Math.sin(wingPhase * 1.4) * 8
    beeRot = Math.sin(wingPhase) * 0.12
    return
  }

  if (mode !== 'playing') return

  beeVy = Math.min(MAX_FALL, beeVy + GRAVITY * t)
  beeY += beeVy * t
  beeRot = Math.max(-0.55, Math.min(1.1, beeVy * 0.09))

  spawnTimer += dt
  if (spawnTimer >= nextSpawnMs) {
    spawnTimer = 0
    spawnPipe()
  }

  for (const pipe of pipes) {
    pipe.x -= PIPE_SPEED * t
    if (!pipe.scored && pipe.x + PIPE_W < BEE_X - BEE_R * 0.2) {
      pipe.scored = true
      pipesPassed += 1
      sfx.pipe()
      addScore(PIPE_POINTS, BEE_X + 24, beeY - 18, `+${PIPE_POINTS}`, '#ffffff')
      spawnBurst(BEE_X + 20, beeY, '#ffd76a')
    }
  }
  pipes = pipes.filter((p) => p.x > -PIPE_W - 20)

  for (const item of pickups) {
    if (item.taken) continue
    item.x -= PIPE_SPEED * t
    item.bob += t * 0.12
    const dy = Math.sin(item.bob) * 6
    const dx = item.x - BEE_X
    const dyy = item.y + dy - beeY
    if (dx * dx + dyy * dyy < (BEE_R + PICKUP_R) * (BEE_R + PICKUP_R)) {
      item.taken = true
      if (item.kind === 'honey') {
        honeyGot += 1
        sfx.honey()
        addScore(HONEY_POINTS, item.x, item.y, `+${HONEY_POINTS}`, '#f5c542')
        spawnBurst(item.x, item.y, '#ffe08a')
      } else {
        flowersGot += 1
        sfx.flower()
        addScore(FLOWER_POINTS, item.x, item.y, `+${FLOWER_POINTS}`, '#ff7eb6')
        spawnBurst(item.x, item.y, '#ffb7d5')
      }
    }
  }
  pickups = pickups.filter((p) => !p.taken && p.x > -40)

  if (beeY + BEE_R > H - GROUND || beeY - BEE_R < 0) {
    die()
    return
  }

  for (const pipe of pipes) {
    if (hitsPipe(pipe)) {
      die()
      return
    }
  }
}

function hitsPipe(pipe: Pipe) {
  const bx = BEE_X
  const by = beeY
  const r = BEE_R * 0.62
  const left = pipe.x
  const right = pipe.x + PIPE_W
  if (bx + r < left || bx - r > right) return false
  const topBottom = pipe.gapY
  const gapBottom = pipe.gapY + pipe.gap
  return by - r < topBottom || by + r > gapBottom
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#6ebef0')
  g.addColorStop(0.45, '#a9dbfb')
  g.addColorStop(1, '#e8f6ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  const sun = ctx.createRadialGradient(W * 0.82, 70, 10, W * 0.82, 70, 120)
  sun.addColorStop(0, 'rgba(255, 236, 150, 0.85)')
  sun.addColorStop(1, 'rgba(255, 236, 150, 0)')
  ctx.fillStyle = sun
  ctx.beginPath()
  ctx.arc(W * 0.82, 70, 120, 0, Math.PI * 2)
  ctx.fill()
}

function drawClouds() {
  for (const c of clouds) {
    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.scale(c.s, c.s)
    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    blob(-18, 0, 22)
    blob(8, -6, 26)
    blob(28, 2, 18)
    ctx.restore()
  }
}

function blob(x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function drawPipes() {
  for (const pipe of pipes) {
    drawLeafPipe(pipe.x, 0, PIPE_W, pipe.gapY, true)
    drawLeafPipe(pipe.x, pipe.gapY + pipe.gap, PIPE_W, H - GROUND - (pipe.gapY + pipe.gap), false)
  }
}

function drawLeafPipe(x: number, y: number, w: number, h: number, top: boolean) {
  if (h <= 0) return
  const grad = ctx.createLinearGradient(x, 0, x + w, 0)
  grad.addColorStop(0, '#2f7544')
  grad.addColorStop(0.45, '#4aa365')
  grad.addColorStop(1, '#2a683d')
  ctx.fillStyle = grad
  roundRect(x, y, w, h, 10)
  ctx.fill()

  const rimH = 22
  const rimY = top ? y + h - rimH : y
  ctx.fillStyle = '#245c36'
  roundRect(x - 5, rimY, w + 10, rimH, 8)
  ctx.fill()
  ctx.fillStyle = '#5cbc78'
  roundRect(x - 2, rimY + 4, w + 4, rimH - 8, 6)
  ctx.fill()

  ctx.fillStyle = '#3f9156'
  for (let i = 0; i < Math.floor(h / 36); i++) {
    const ly = top ? y + 18 + i * 36 : y + h - 28 - i * 36
    if (ly < y + 8 || ly > y + h - 8) continue
    ctx.beginPath()
    ctx.ellipse(x + 8, ly, 10, 6, -0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x + w - 8, ly + 8, 10, 6, 0.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function drawGround() {
  const y = H - GROUND
  const g = ctx.createLinearGradient(0, y, 0, H)
  g.addColorStop(0, '#6bbf5c')
  g.addColorStop(0.35, '#4e9a48')
  g.addColorStop(1, '#3a7338')
  ctx.fillStyle = g
  ctx.fillRect(0, y, W, GROUND)

  ctx.fillStyle = '#7ad06a'
  ctx.fillRect(0, y, W, 10)

  for (const f of groundBlooms) {
    const fx = ((f.x - groundScroll) % (W + 40) + W + 40) % (W + 40) - 20
    const fy = y + 28 + Math.sin(f.bob) * 3
    drawFlowerSprite(fx, fy, f.hue, 1)
  }
}

function drawFlowerSprite(x: number, y: number, hue: number, scale: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = `hsl(${hue} 78% 58%)`
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    ctx.beginPath()
    ctx.ellipse(Math.cos(a) * 6, Math.sin(a) * 6, 5, 3.5, a, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#ffe566'
  ctx.beginPath()
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawHoneySprite(x: number, y: number, pulse: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(pulse, pulse)

  const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22)
  glow.addColorStop(0, 'rgba(255, 214, 90, 0.55)')
  glow.addColorStop(1, 'rgba(255, 214, 90, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(0, 0, 22, 0, Math.PI * 2)
  ctx.fill()

  // droplet
  ctx.fillStyle = '#f0b429'
  ctx.beginPath()
  ctx.moveTo(0, -14)
  ctx.bezierCurveTo(12, -4, 11, 10, 0, 14)
  ctx.bezierCurveTo(-11, 10, -12, -4, 0, -14)
  ctx.fill()
  ctx.fillStyle = '#ffe566'
  ctx.beginPath()
  ctx.ellipse(-3, -2, 3.5, 5, -0.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawPickups() {
  for (const item of pickups) {
    if (item.taken) continue
    const y = item.y + Math.sin(item.bob) * 6
    if (item.kind === 'honey') {
      drawHoneySprite(item.x, y, 1 + Math.sin(item.bob * 2) * 0.08)
    } else {
      const hue = 330 + Math.sin(item.bob) * 12
      drawFlowerSprite(item.x, y, hue, 1.55)
      // soft glow ring
      ctx.strokeStyle = 'rgba(255, 150, 200, 0.45)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(item.x, y, 16, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

function drawBee() {
  ctx.save()
  ctx.translate(BEE_X, beeY)
  ctx.rotate(beeRot)

  const flapAmt = Math.sin(wingPhase * (mode === 'playing' ? 18 : 8))

  ctx.fillStyle = 'rgba(190, 230, 255, 0.75)'
  ctx.save()
  ctx.rotate(-0.5 + flapAmt * 0.35)
  ctx.beginPath()
  ctx.ellipse(-8, -16, 16, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.rotate(0.35 - flapAmt * 0.35)
  ctx.fillStyle = 'rgba(210, 240, 255, 0.65)'
  ctx.beginPath()
  ctx.ellipse(-14, -4, 14, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  const body = ctx.createLinearGradient(-18, 0, 18, 0)
  body.addColorStop(0, '#f7d056')
  body.addColorStop(1, '#e9a820')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#2a2118'
  ctx.lineWidth = 4.5
  ctx.lineCap = 'round'
  for (const sx of [-8, 0, 8]) {
    ctx.beginPath()
    ctx.moveTo(sx, -11)
    ctx.lineTo(sx, 11)
    ctx.stroke()
  }

  ctx.fillStyle = '#2a2118'
  ctx.beginPath()
  ctx.arc(16, -2, 9, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(19, -4, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a140f'
  ctx.beginPath()
  ctx.arc(19.6, -4, 1.2, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#2a2118'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(18, -10)
  ctx.quadraticCurveTo(22, -22, 28, -18)
  ctx.moveTo(14, -10)
  ctx.quadraticCurveTo(14, -24, 22, -22)
  ctx.stroke()
  ctx.fillStyle = '#2a2118'
  ctx.beginPath()
  ctx.arc(28, -18, 2, 0, Math.PI * 2)
  ctx.arc(22, -22, 2, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#2a2118'
  ctx.beginPath()
  ctx.moveTo(-20, 0)
  ctx.lineTo(-27, -3)
  ctx.lineTo(-27, 3)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = p.color
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawFloatTexts() {
  ctx.save()
  ctx.font = '700 18px Fredoka, sans-serif'
  ctx.textAlign = 'center'
  for (const f of floatTexts) {
    ctx.globalAlpha = Math.max(0, f.life)
    ctx.fillStyle = f.color
    ctx.strokeStyle = 'rgba(42,33,24,0.35)'
    ctx.lineWidth = 3
    ctx.strokeText(f.text, f.x, f.y)
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function render() {
  drawSky()
  drawClouds()
  drawPipes()
  drawPickups()
  drawGround()
  drawBee()
  drawParticles()
  drawFloatTexts()
}

function loop(ts: number) {
  const dt = Math.min(32, ts - (lastTs || ts))
  lastTs = ts
  update(dt)
  render()
  animId = requestAnimationFrame(loop)
}

function onPointer(e: Event) {
  e.preventDefault()
  if (mode === 'start' || mode === 'dead') return
  flap()
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault()
    if (mode === 'dead') {
      if (e.repeat) return
      goToReady()
      return
    }
    if (mode === 'start') {
      if (e.repeat) return
      goToReady()
      return
    }
    if (!e.repeat) flap()
  }
  if (e.code === 'Enter') {
    if (mode === 'dead') goToReady()
    if (mode === 'start') goToReady()
  }
}

canvas.addEventListener('pointerdown', onPointer)
window.addEventListener('keydown', onKey)

overlayEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-action="play"]') || t.closest('[data-action="again"]')) {
    goToReady()
  }
  if (t.closest('[data-action="menu"]')) {
    showStartScreen()
  }
})

showStartScreen()
animId = requestAnimationFrame(loop)

Object.assign(window, {
  __flappyBee: {
    state: () => ({
      mode,
      beeY,
      beeVy,
      score,
      pipes: pipes.length,
      honey: honeyGot,
      flowers: flowersGot,
    }),
  },
})

void animId
