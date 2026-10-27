import './style.css'

declare global {
  interface Window {
    __flappyBee: {
      triggerWin: () => void
    }
  }
}

const params = new URLSearchParams(window.location.search)
const WIN_SCORE = Math.max(1, Number(params.get('win') || 10) || 10)
const GINZA_SITE = 'https://gin-pachi.jp'
const GINZA_DONATE = 'https://syncable.biz/associate/ginpachi/donate'

type Mode = 'ready' | 'playing' | 'dead' | 'won'

interface Pipe {
  x: number
  gapY: number
  scored: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
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
      <div class="score hidden" id="score">0</div>
      <div class="hint" id="hint">Tap or press Space to fly</div>
    </div>
    <div class="overlay" id="overlay" aria-live="polite">
      <div class="panel" id="panel"></div>
    </div>
  </div>
`

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const ctx = canvas.getContext('2d')!
const scoreEl = document.querySelector<HTMLDivElement>('#score')!
const hintEl = document.querySelector<HTMLDivElement>('#hint')!
const overlayEl = document.querySelector<HTMLDivElement>('#overlay')!
const panelEl = document.querySelector<HTMLDivElement>('#panel')!

const W = canvas.width
const H = canvas.height
const GROUND = 84
const BEE_X = W * 0.28
const BEE_R = 22
const PIPE_W = 72
const GAP = 178
const PIPE_SPEED = 2.4
const GRAVITY = 0.38
const FLAP = -7.1
const SPAWN_EVERY = 100

let mode: Mode = 'ready'
let beeY = H * 0.45
let beeVy = 0
let beeRot = 0
let wingPhase = 0
let frame = 0
let pipes: Pipe[] = []
let particles: Particle[] = []
let score = 0
let clouds = createClouds()
let flowers = createFlowers()
let lastTs = 0
let animId = 0

function createClouds() {
  return Array.from({ length: 5 }, (_, i) => ({
    x: (i * 110 + 40) % (W + 120),
    y: 40 + (i % 3) * 48,
    s: 0.55 + (i % 3) * 0.2,
    speed: 0.18 + (i % 4) * 0.06,
  }))
}

function createFlowers() {
  return Array.from({ length: 9 }, (_, i) => ({
    x: 20 + i * 48,
    bob: Math.random() * Math.PI * 2,
    hue: 28 + (i % 4) * 18,
  }))
}

function resetGame() {
  mode = 'ready'
  beeY = H * 0.45
  beeVy = 0
  beeRot = 0
  wingPhase = 0
  frame = 0
  pipes = []
  particles = []
  score = 0
  scoreEl.textContent = '0'
  scoreEl.classList.add('hidden')
  scoreEl.classList.remove('bump')
  hintEl.classList.remove('hidden')
  hideOverlay()
}

function startPlaying() {
  if (mode === 'playing') return
  mode = 'playing'
  beeVy = FLAP
  hintEl.classList.add('hidden')
  scoreEl.classList.remove('hidden')
  hideOverlay()
  spawnBurst(BEE_X, beeY, '#ffe08a')
}

function flap() {
  if (mode === 'ready') {
    startPlaying()
    return
  }
  if (mode === 'playing') {
    beeVy = FLAP
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
      maxLife: 1,
      size: 2 + Math.random() * 3,
      color,
    })
  }
}

function randomGapY() {
  const margin = 110
  return margin + Math.random() * (H - GROUND - GAP - margin * 2)
}

function update(dt: number) {
  wingPhase += dt * 0.028
  for (const c of clouds) {
    c.x -= c.speed * dt * 0.06
    if (c.x < -100) c.x = W + 60
  }
  for (const f of flowers) f.bob += dt * 0.004

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx * dt * 0.06
    p.y += p.vy * dt * 0.06
    p.vy += 0.05 * dt * 0.06
    p.life -= dt * 0.0018
    if (p.life <= 0) particles.splice(i, 1)
  }

  if (mode === 'ready') {
    beeY = H * 0.45 + Math.sin(wingPhase * 1.4) * 8
    beeRot = Math.sin(wingPhase) * 0.12
    return
  }

  if (mode !== 'playing') return

  frame += 1
  beeVy += GRAVITY
  beeY += beeVy
  beeRot = Math.max(-0.55, Math.min(1.1, beeVy * 0.08))

  if (frame % SPAWN_EVERY === 0) {
    pipes.push({ x: W + 20, gapY: randomGapY(), scored: false })
  }

  for (const pipe of pipes) {
    pipe.x -= PIPE_SPEED
    if (!pipe.scored && pipe.x + PIPE_W < BEE_X - BEE_R * 0.2) {
      pipe.scored = true
      score += 1
      scoreEl.textContent = String(score)
      scoreEl.classList.remove('bump')
      void scoreEl.offsetWidth
      scoreEl.classList.add('bump')
      spawnBurst(BEE_X + 20, beeY, '#ffd76a')
      if (score >= WIN_SCORE) {
        win()
        return
      }
    }
  }
  pipes = pipes.filter((p) => p.x > -PIPE_W - 20)

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
  const r = BEE_R * 0.72
  const left = pipe.x
  const right = pipe.x + PIPE_W
  if (bx + r < left || bx - r > right) return false
  const topBottom = pipe.gapY
  const gapBottom = pipe.gapY + GAP
  return by - r < topBottom || by + r > gapBottom
}

function die() {
  mode = 'dead'
  spawnBurst(BEE_X, beeY, '#ffb4a2')
  showOverlay('dead')
}

function win() {
  mode = 'won'
  spawnBurst(BEE_X, beeY, '#ffe08a')
  spawnBurst(BEE_X, beeY - 20, '#fff')
  showOverlay('won')
}

function hideOverlay() {
  overlayEl.classList.remove('visible')
}

function showOverlay(kind: 'dead' | 'won') {
  const beeMark = `
    <div class="emoji-bee" aria-hidden="true">
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none">
        <ellipse cx="32" cy="36" rx="16" ry="12" fill="#F5C542"/>
        <path d="M20 32h24M20 38h24M20 44h24" stroke="#2A2118" stroke-width="3.5" stroke-linecap="round"/>
        <circle cx="44" cy="28" r="8" fill="#2A2118"/>
        <circle cx="47" cy="26" r="2.2" fill="#fff"/>
        <ellipse cx="22" cy="24" rx="10" ry="7" fill="#B8E4FF" fill-opacity=".85" transform="rotate(-18 22 24)"/>
      </svg>
    </div>`

  if (kind === 'won') {
    panelEl.innerHTML = `
      ${beeMark}
      <h2>You made it!</h2>
      <p>
        Score ${WIN_SCORE} — the hive is buzzing.
        Please support the <strong>Ginza Honey Bee Project</strong>,
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
      </div>
      <p class="win-note">Unofficial tribute game · not affiliated with the NPO</p>
    `
  } else {
    panelEl.innerHTML = `
      ${beeMark}
      <h2>Ouch!</h2>
      <p>Score: <strong>${score}</strong> / ${WIN_SCORE}. Reach ${WIN_SCORE} to help the hive — and support Ginza’s bees.</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="again">Try again</button>
      </div>
    `
  }
  overlayEl.classList.add('visible')
}

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#6ebef0')
  g.addColorStop(0.45, '#a9dbfb')
  g.addColorStop(1, '#e8f6ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // soft sun glow
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
    drawLeafPipe(pipe.x, pipe.gapY + GAP, PIPE_W, H - GROUND - (pipe.gapY + GAP), false)
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

  // rim / mouth
  const rimH = 22
  const rimY = top ? y + h - rimH : y
  ctx.fillStyle = '#245c36'
  roundRect(x - 5, rimY, w + 10, rimH, 8)
  ctx.fill()
  ctx.fillStyle = '#5cbc78'
  roundRect(x - 2, rimY + 4, w + 4, rimH - 8, 6)
  ctx.fill()

  // leaf nubs
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

  for (const f of flowers) {
    const fx = ((f.x - frame * 0.8) % (W + 40) + W + 40) % (W + 40) - 20
    const fy = y + 28 + Math.sin(f.bob) * 3
    drawFlower(fx, fy, f.hue)
  }
}

function drawFlower(x: number, y: number, hue: number) {
  ctx.save()
  ctx.translate(x, y)
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

function drawBee() {
  ctx.save()
  ctx.translate(BEE_X, beeY)
  ctx.rotate(beeRot)

  const flap = Math.sin(wingPhase * (mode === 'playing' ? 18 : 8))

  // wings
  ctx.fillStyle = 'rgba(190, 230, 255, 0.75)'
  ctx.save()
  ctx.rotate(-0.5 + flap * 0.35)
  ctx.beginPath()
  ctx.ellipse(-8, -16, 16, 9, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.rotate(0.35 - flap * 0.35)
  ctx.fillStyle = 'rgba(210, 240, 255, 0.65)'
  ctx.beginPath()
  ctx.ellipse(-14, -4, 14, 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // body
  const body = ctx.createLinearGradient(-18, 0, 18, 0)
  body.addColorStop(0, '#f7d056')
  body.addColorStop(1, '#e9a820')
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.ellipse(0, 0, 20, 14, 0, 0, Math.PI * 2)
  ctx.fill()

  // stripes
  ctx.strokeStyle = '#2a2118'
  ctx.lineWidth = 4.5
  ctx.lineCap = 'round'
  for (const sx of [-8, 0, 8]) {
    ctx.beginPath()
    ctx.moveTo(sx, -11)
    ctx.lineTo(sx, 11)
    ctx.stroke()
  }

  // head
  ctx.fillStyle = '#2a2118'
  ctx.beginPath()
  ctx.arc(16, -2, 9, 0, Math.PI * 2)
  ctx.fill()

  // eye
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(19, -4, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#1a140f'
  ctx.beginPath()
  ctx.arc(19.6, -4, 1.2, 0, Math.PI * 2)
  ctx.fill()

  // antennae
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

  // stinger hint
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

function render() {
  drawSky()
  drawClouds()
  drawPipes()
  drawGround()
  drawBee()
  drawParticles()
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
  if (mode === 'dead' || mode === 'won') return
  flap()
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault()
    if (mode === 'dead' || mode === 'won') {
      if (e.repeat) return
      resetGame()
      return
    }
    if (!e.repeat) flap()
  }
  if (e.code === 'Enter' && (mode === 'dead' || mode === 'won')) {
    resetGame()
  }
}

canvas.addEventListener('pointerdown', onPointer)
window.addEventListener('keydown', onKey)

overlayEl.addEventListener('click', (e) => {
  const t = e.target as HTMLElement
  if (t.closest('[data-action="again"]')) {
    resetGame()
  }
})

resetGame()
animId = requestAnimationFrame(loop)

// Dev/demo helper for screenshots and manual QA (not used by normal play)
Object.assign(window, {
  __flappyBee: {
    triggerWin: () => {
      score = WIN_SCORE
      scoreEl.textContent = String(score)
      scoreEl.classList.remove('hidden')
      win()
    },
  },
})

void animId
