// ==========================================
// --- CONFIGURATION & TUNING ---
// ==========================================

// --- TEXT SETTINGS ---
const TEXT_TO_DISPLAY = "ETCETERA";
const FONT_SIZE = 200;
const WINDOW_HEIGHT = FONT_SIZE * 3;

// --- OP ART GRID SETTINGS ---
const WAVE_AMP_Y = 50.0;
const WAVE_FREQ_Y = 0.006;
const WAVE_AMP_X = 20.0;
const WAVE_FREQ_X = 0.015;
const GRID_DENSITY_X = 10;
const GRID_DENSITY_Y = 3;

// --- PHYSICS ---
const MAGNET_RADIUS = 35;
const MAGNET_RADIUS_SQ = MAGNET_RADIUS * MAGNET_RADIUS; // Pre-calc
const SPRING_STIFFNESS = 0.05;
const SPRING_DAMPING = 0.90;
const BREAK_FORCE = 4.0;
const SHED_CHANCE = 0.002;

// --- WAVE ---
const ACTIVATION_SPEED = 1.5;
const ACTIVATION_MAX_RAD = 4000;
const PULSE_SPEED = 0.05;
const PULSE_FREQ = 0.02;
const PULSE_SHARPNESS = 12;

// --- FLOW & PARTICLES ---
const FLOW_SPEED = 2.0;
const PARTICLE_COUNT = 8000;
const MIN_SIZE = 2;
const MAX_SIZE = 8;
const MAX_SEPARATION_CHECKS = 12; // Optimization: Stop checking after this many neighbors

// ==========================================
// --- RUNTIME GLOBALS ---
// ==========================================
let particles = [];
let targets = [];
let targetGrid = [];
let activationRadius = 0;
let timeAccumulator = 0;
let pulseOriginX, pulseOriginY; // Raw coords instead of vector               
let pg;

// --- SPATIAL GRID CONFIG ---
const GRID_SIZE = 50;
let numCols, numRows;
let neighborGrid = [];

function setup() {
    createCanvas(windowWidth, WINDOW_HEIGHT);

    // 1. Text Buffer Setup
    pg = createGraphics(width, height);
    pg.pixelDensity(1);
    pg.background(0);
    pg.textSize(FONT_SIZE);
    pg.textAlign(CENTER, CENTER);
    pg.textStyle(BOLD);
    pg.fill(255);
    pg.text(TEXT_TO_DISPLAY, width / 2, height / 2);

    // 2. Calculate Exact Origin
    textSize(FONT_SIZE);
    textStyle(BOLD);
    let totalTextWidth = textWidth(TEXT_TO_DISPLAY);
    let startX = (width / 2) - (totalTextWidth / 2) + 60;
    pulseOriginX = startX;
    pulseOriginY = height / 2;

    // 3. Setup Spatial Grids
    numCols = ceil(width / GRID_SIZE);
    numRows = ceil(height / GRID_SIZE);
    neighborGrid = new Array(numCols * numRows).fill(0).map(() => []);
    targetGrid = new Array(numCols * numRows).fill(0).map(() => []);

    // 4. GENERATE TARGETS
    targets = [];
    pg.loadPixels();
    const d = pg.pixelDensity();
    const pixelWidth = width * d;

    for (let yBase = -100; yBase < height + 100; yBase += GRID_DENSITY_Y) {
        // Pre-calc Y-based pinch to save math inside inner loop
        let pinchOffset = WAVE_AMP_X * sin(yBase * WAVE_FREQ_X);

        for (let xBase = 0; xBase < width; xBase += GRID_DENSITY_X) {

            let waveY = yBase + WAVE_AMP_Y * sin(xBase * WAVE_FREQ_Y);
            let waveX = xBase + pinchOffset;

            if (waveX >= 0 && waveX < width && waveY >= 0 && waveY < height) {
                let px = (waveX | 0); // Bitwise floor
                let py = (waveY | 0);
                let index = 4 * ((py * d) * pixelWidth + (px * d));

                if (pg.pixels[index] > 128) {
                    let t = new Target(waveX, waveY);
                    targets.push(t);

                    let gx = (t.x / GRID_SIZE) | 0;
                    let gy = (t.y / GRID_SIZE) | 0;
                    if (gx >= 0 && gx < numCols && gy >= 0 && gy < numRows) {
                        targetGrid[gx + gy * numCols].push(t);
                    }
                }
            }
        }
    }

    // 5. Create Particles
    particles = new Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles[i] = new Particle();
    }
}

function draw() {
    background(5, 5, 10);
    blendMode(ADD);

    let dt = constrain(deltaTime / 16.6, 0.5, 2);
    timeAccumulator += dt;

    // --- RADIAL ACTIVATION LOGIC ---
    activationRadius += ACTIVATION_SPEED * dt;
    if (activationRadius > ACTIVATION_MAX_RAD) activationRadius = 0;

    // --- OPTIMIZED SPATIAL HASHING ---
    // 1. Clear Grid
    for (let i = 0; i < neighborGrid.length; i++) {
        neighborGrid[i].length = 0;
    }

    // 2. Populate Grid
    // Using a simple for loop is slightly faster than for...of in hot paths
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        let p = particles[i];
        let gx = (p.x / GRID_SIZE) | 0;
        let gy = (p.y / GRID_SIZE) | 0;

        if (gx >= 0 && gx < numCols && gy >= 0 && gy < numRows) {
            neighborGrid[gx + gy * numCols].push(p);
        }
    }

    // 3. Run Particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles[i].run(dt);
    }

    blendMode(BLEND);
}

function windowResized() {
    resizeCanvas(windowWidth, FONT_SIZE * 1.5);
    setup();
    activationRadius = 0;
}

// --- Target Class (Optimized) ---
class Target {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.takenBy = null;
    }

    // Removed getter to avoid property lookup overhead in hot loops
    checkActive() {
        let dx = this.x - pulseOriginX;
        let dy = this.y - pulseOriginY;
        return (dx * dx + dy * dy) < (activationRadius * activationRadius);
    }
}

// --- Particle Class (Optimized - No Vectors) ---
class Particle {
    constructor() {
        this.reset(true);
    }

    reset(randomX = false) {
        // Raw coordinates
        this.x = randomX ? random(width) : -50;
        this.y = random(height);

        // Raw velocity
        this.vx = random(1, 3);
        this.vy = 0;

        // Raw acceleration
        this.ax = 0;
        this.ay = 0;

        this.target = null;
        this.z = random(0, 0.1);
        this.alpha = 0;
    }

    run(dt) {
        this.findTarget();
        this.checkShedding();
        this.updatePhysics(dt);
        this.separate();
        this.integration(dt);
        this.show();
    }

    findTarget() {
        if (this.target) return;

        let dx = this.x - pulseOriginX;
        let dy = this.y - pulseOriginY;
        let distSq = dx * dx + dy * dy;
        let actRadBuffer = activationRadius + 150;

        if (distSq > actRadBuffer * actRadBuffer) return;

        let gx = (this.x / GRID_SIZE) | 0;
        let gy = (this.y / GRID_SIZE) | 0;

        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                let col = gx + i;
                let row = gy + j;
                if (col >= 0 && col < numCols && row >= 0 && row < numRows) {
                    let cell = targetGrid[col + row * numCols];
                    // standard for loop is faster
                    for (let k = 0; k < cell.length; k++) {
                        let t = cell[k];
                        if (t.takenBy === null && t.checkActive()) {
                            let tdx = this.x - t.x;
                            let tdy = this.y - t.y;
                            if ((tdx * tdx + tdy * tdy) < MAGNET_RADIUS_SQ) {
                                this.target = t;
                                t.takenBy = this;
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    checkShedding() {
        if (!this.target) return;

        if (Math.random() < SHED_CHANCE) {
            this.shed();
            return;
        }

        // Magnitude squared check is faster than mag()
        if ((this.vx * this.vx + this.vy * this.vy) > (BREAK_FORCE * BREAK_FORCE)) {
            this.shed();
            return;
        }

        let dx = this.x - this.target.x;
        let dy = this.y - this.target.y;

        if ((dx * dx + dy * dy) > 3600) { // 60 squared
            this.shed();
            return;
        }
    }

    shed() {
        if (this.target) {
            this.target.takenBy = null;
            this.target = null;
        }
    }

    updatePhysics(dt) {
        let dx = this.x - pulseOriginX;
        let dy = this.y - pulseOriginY;
        let distFromPulse = Math.sqrt(dx * dx + dy * dy);

        let theta = distFromPulse * PULSE_FREQ - timeAccumulator * PULSE_SPEED;
        let rawWave = Math.sin(theta);
        let normWave = (rawWave + 1) / 2;
        let sharpWave = Math.pow(normWave, PULSE_SHARPNESS);
        let waveZ = map(sharpWave, 0, 1, 0.05, 0.8);

        if (this.target) {
            // === DOCKED ===
            this.z = lerp(this.z, 1.0, 0.05 * dt);

            // Heat Haze Distortion - Using cached references to Math.random or p5 noise
            // Optimization: Reduce noise calls or frequency if needed, but here we stick to logic
            let noiseScale = 0.003;
            let timeScale = 0.005;

            let noiseX = noise(this.target.x * noiseScale, this.target.y * noiseScale, timeAccumulator * timeScale);
            let noiseY = noise(this.target.x * noiseScale, this.target.y * noiseScale + 500, timeAccumulator * timeScale);

            // map manual
            let offX = -10 + noiseX * 20;
            let offY = -10 + noiseY * 20;

            let targetX = this.target.x + offX;
            let targetY = this.target.y + offY;

            let springDx = targetX - this.x;
            let springDy = targetY - this.y;

            this.ax += springDx * SPRING_STIFFNESS;
            this.ay += springDy * SPRING_STIFFNESS;

            this.vx *= SPRING_DAMPING;
            this.vy *= SPRING_DAMPING;

        } else {
            // === FREE FLOW ===
            this.z = lerp(this.z, waveZ, 0.2 * dt);

            let n = noise(this.x * 0.005, this.y * 0.005, timeAccumulator * 0.005);
            let angle = n * TWO_PI - PI; // map(n, 0, 1, -PI, PI) manually

            this.ax += Math.cos(angle) * 0.15;
            this.ay += Math.sin(angle) * 0.15;
            this.ax += 0.1;

            this.vx *= 0.98;
            this.vy *= 0.98;
        }
    }

    separate() {
        let gx = (this.x / GRID_SIZE) | 0;
        let gy = (this.y / GRID_SIZE) | 0;

        let count = 0;
        let sumX = 0, sumY = 0;
        let checks = 0;

        loopOuter:
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                let col = gx + i;
                let row = gy + j;
                if (col >= 0 && col < numCols && row >= 0 && row < numRows) {
                    let cell = neighborGrid[col + row * numCols];

                    for (let k = 0; k < cell.length; k++) {
                        let other = cell[k];
                        if (other !== this) {

                            // Optimization: Cap checks
                            checks++;
                            if (checks > MAX_SEPARATION_CHECKS) break loopOuter;

                            let dx = this.x - other.x;
                            let dy = this.y - other.y;
                            // Cheap check first using pre-calc approximation (manhattan distance)
                            if (Math.abs(dx) > 20 || Math.abs(dy) > 20) continue;

                            let dSq = dx * dx + dy * dy;

                            let myRad = 10 * (0.4 + this.z * 0.6);
                            let theirRad = 10 * (0.4 + other.z * 0.6);
                            let minDist = myRad + theirRad;
                            let rSq = minDist * minDist;

                            if (dSq < rSq && dSq > 0.001) {
                                let d = Math.sqrt(dSq);
                                let force = (minDist - d) / minDist;
                                sumX += (dx / d) * force;
                                sumY += (dy / d) * force;
                                count++;
                            }
                        }
                    }
                }
            }
        }

        if (count > 0) {
            let strength = this.target ? 1.0 : 1.5;
            this.ax += (sumX / count) * strength;
            this.ay += (sumY / count) * strength;
        }
    }

    integration(dt) {
        // Add Acc to Vel
        this.vx += this.ax;
        this.vy += this.ay;

        // Limit speed manual
        if (!this.target) {
            let speedSq = this.vx * this.vx + this.vy * this.vy;
            let limit = FLOW_SPEED * 2;
            if (speedSq > limit * limit) {
                let mag = Math.sqrt(speedSq);
                this.vx = (this.vx / mag) * limit;
                this.vy = (this.vy / mag) * limit;
            }
        }

        // Add Vel to Pos
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Clear Acc
        this.ax = 0;
        this.ay = 0;

        if (this.alpha < 255) this.alpha += 5 * dt;

        if (!this.target && this.x > width + 50) {
            this.reset(false);
        }
    }

    show() {
        this.currentSize = lerp(MIN_SIZE, MAX_SIZE, this.z);

        // FIX: Keep the minimum brightness much higher
        let b = map(this.z, 0, 1, 180, 255);

        // FIX: Don't fade opacity as much
        let a = map(this.z, 0, 1, 200, this.alpha);

        noStroke();
        fill(b, b, b, a);

        // --- THE ERROR WAS HERE ---
        // OLD WAY (Vector): ellipse(this.pos.x, this.pos.y, this.currentSize);
        // NEW WAY (Raw coords):
        ellipse(this.x, this.y, this.currentSize);
    }
}