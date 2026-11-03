/**
 * Hlavní herní scéna: dráhy, zombíci s textem, lock-on psaní, životy, věže, boss.
 */
import Phaser from "phaser";
import { bridge } from "../bridge";
import { chapterById, levelId } from "../content/curriculum";
import { roundConfig, type RoundConfig, type ZombieKind } from "../content/levels";
import { WordGenerator, type KeyStat, type WordList } from "../content/words";
import { TypingInput } from "../input/TypingInput";
import { accuracy, grossCpm, netCpm, stars } from "@/lib/scoring";
import { soundManager } from "../audio/soundManager";
import type { BoostState, BoostType, HudState, RunResult, TurretKind } from "../types";
import { TEX } from "./BootScene";

export interface LevelData {
  chapter: number;
  round: number;
  words: WordList;
  keyStats: Record<string, KeyStat>;
  playerCpm: number;
  parent: HTMLElement;
  zenMode?: boolean;
  zenSpeed?: number;
}

const W = 1280;
const H = 720;
const LANES = 4;
const LANE_TOP = 150;
const LANE_H = 142;
const HOUSE_X = 130;
const SPAWN_X = W + 60;

interface Zombie {
  kind: ZombieKind;
  lane: number;
  sprite: Phaser.GameObjects.Image;
  container: Phaser.GameObjects.Container;
  labelBg: Phaser.GameObjects.Graphics;
  typedText: Phaser.GameObjects.Text;
  restText: Phaser.GameObjects.Text;
  word: string;
  typed: number;
  speed: number; // px/s
  /** zbývající slova (boss / obrněný) */
  queue: string[];
  hp: number;
  maxHp: number;
  dead: boolean;
  slowUntil?: number;
  stunUntil?: number;
}

export interface Tower {
  kind: TurretKind;
  lane: number;
  sprite: Phaser.GameObjects.Image;
  expiresAt: number;
  nextShotAt: number;
}

export class LevelScene extends Phaser.Scene {
  private data_!: LevelData;
  private cfg!: RoundConfig;
  private gen!: WordGenerator;
  private input_!: TypingInput;

  private zombies: Zombie[] = [];
  private towers: Tower[] = [];
  private locked: Zombie | null = null;
  private crosshair!: Phaser.GameObjects.Container;
  private lastBackspaceTime = 0;
  private spawned = 0;
  private bossSpawned = false;
  private finished = false;
  private started = false;
  private startAt = 0;
  private isPaused = false;
  private pauseStartAt = 0;
  private totalPauseDurationMs = 0;
  private startTimer?: Phaser.Time.TimerEvent;

  private lives = 5;
  private livesLost = 0;
  private score = 0;
  private combo = 0;
  private maxCombo = 0;
  private kills = 0;
  private correct = 0;
  private errors = 0;
  private keystrokes: [number, 0 | 1][] = [];
  private keyStats: Record<string, KeyStat> = {};

  private activeBoost: {
    type: BoostType;
    title: string;
    icon: string;
    word: string;
    typed: number;
  } | null = null;
  private boostLocked = false;
  private killsSinceBoost = 0;
  private freezeUntil = 0;
  private errorSpeedBoostUntil = 0; // dočasné zrychlení zombíků po chybě

  private hudTimer = 0;
  private spawnEvent?: Phaser.Time.TimerEvent;
  private ground!: Phaser.GameObjects.Graphics;

  constructor() {
    super("Level");
  }

  init(data: LevelData) {
    this.data_ = data;
    this.cfg = roundConfig(data.chapter, data.round, data.playerCpm);
    this.lives = this.cfg.lives;
    // hluboká kopie: registerKey mění vnitřní objekty a data_ se znovu použijí při restartu
    this.keyStats = Object.fromEntries(Object.entries(data.keyStats).map(([k, s]) => [k, { ...s }]));
    this.zombies = [];
    this.towers = [];
    this.locked = null;
    this.lastBackspaceTime = 0;
    this.spawned = 0;
    this.bossSpawned = false;
    this.finished = false;
    this.started = false;
    this.isPaused = false;
    this.pauseStartAt = 0;
    this.totalPauseDurationMs = 0;
    this.startTimer = undefined;
    this.livesLost = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.kills = 0;
    this.correct = 0;
    this.errors = 0;
    this.keystrokes = [];
    this.activeBoost = null;
    this.boostLocked = false;
    this.killsSinceBoost = 0;
    this.freezeUntil = 0;
    this.startAt = 0;
    this.hudTimer = 0;
  }

  create() {
    const chapter = chapterById(this.data_.chapter)!;
    this.gen = new WordGenerator({
      chapter,
      round: this.data_.round,
      words: this.data_.words,
      keyStats: this.keyStats,
    });

    this.drawBackground();
    const house = this.add.image(-10, LANE_TOP + LANES * LANE_H + 4, TEX.house).setOrigin(0, 1).setDepth(1);
    house.setScale(Math.min(250 / house.width, (LANES * LANE_H) / house.height));

    const title = this.add
      .text(W / 2, H / 2 - 40, `${chapter.name}\nkolo ${this.data_.round}${this.data_.zenMode ? "\n🧘 Zen trénink" : ""}`, {
        fontFamily: "system-ui, sans-serif",
        fontSize: this.data_.zenMode ? "38px" : "44px",
        color: "#ffffff",
        align: "center",
        stroke: "#000000",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(100);
    const hintText = this.data_.zenMode
      ? "Klidný trénink bez stresu. Piš vlastním tempem…"
      : "Piš písmena na zombících. Začni psát…";
    const hint = this.add
      .text(W / 2, H / 2 + 50, hintText, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "24px",
        color: "#ffe066",
        stroke: "#000000",
        strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(100);

    this.input_ = new TypingInput(this.data_.parent, {
      onChar: (ch, t) => this.onChar(ch, t),
      onBackspace: () => this.onBackspace(),
      onEscape: () => this.togglePause(),
      onRestart: () => this.restartLevel(),
    });
    this.createCrosshair();

    const offToggleBoost = bridge.onTyped("toggle-boost", (force?: boolean) => this.toggleBoostLock(force));

    const startGame = () => {
      if (this.started) return;
      this.started = true;
      this.startAt = performance.now();
      this.startTimer = undefined;
      // první zombík hned; spawnZombie si sám založí časovač dalších (jinak by běžely dva)
      this.spawnZombie();
      this.tweens.add({
        targets: [title, hint],
        alpha: 0,
        duration: 500,
        delay: 800,
        onComplete: () => {
          title.destroy();
          hint.destroy();
        },
      });
    };

    startGame();

    this.events.once("first-key", () => {
      if (title.active) {
        this.tweens.killTweensOf([title, hint]);
        title.destroy();
        hint.destroy();
      }
    });

    const offToggleMute = bridge.onTyped("toggle-mute", () => {
      soundManager.toggleMute();
    });
    const offSoundMute = soundManager.addListener(() => {
      this.emitHud();
    });
    const offResume = bridge.onTyped("resume-level", () => this.setPaused(false));
    const offPause = bridge.onTyped("pause-level", () => this.setPaused(true));
    const offRestart = bridge.onTyped("restart-level", () => this.restartLevel());

    // První bůst nabídneme krátce po začátku hry
    this.time.delayedCall(3500, () => {
      if (!this.activeBoost && !this.finished) this.offerBoost();
    });

    // game.destroy() při odmountování SHUTDOWN nevyšle, jen DESTROY — úklid musí běžet v obou případech
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      offToggleMute();
      offSoundMute();
      offToggleBoost();
      this.input_.dispose();
      this.spawnEvent?.remove();
      this.startTimer?.remove();
      offResume();
      offPause();
      offRestart();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);

    bridge.emitTyped("level-ready");
    this.emitHud();
  }

  private drawBackground() {
    this.ground = this.add.graphics();
    if (this.textures.exists(TEX.background)) {
      // pozadí má 4 pruhy trávníku od ~23 % výšky dolů; napasujeme je na naše dráhy
      const img = this.textures.get(TEX.background).getSourceImage() as HTMLImageElement;
      const lanesTopRatio = 0.235;
      const s = (LANES * LANE_H) / (img.height * (1 - lanesTopRatio));
      this.add
        .image(0, LANE_TOP - img.height * lanesTopRatio * s, TEX.background)
        .setOrigin(0, 0)
        .setDisplaySize(W, img.height * s)
        .setDepth(0);
      return;
    }
    const colors = [0x4a7c59, 0x3e6b4c];
    for (let i = 0; i < LANES; i++) {
      this.ground.fillStyle(colors[i % 2], 1);
      this.ground.fillRect(0, LANE_TOP + i * LANE_H, W, LANE_H);
    }
    this.ground.fillStyle(0x1e2a24, 1).fillRect(0, 0, W, LANE_TOP);
    this.ground.fillStyle(0x2c3e50, 1).fillRect(0, LANE_TOP + LANES * LANE_H, W, H - LANE_TOP - LANES * LANE_H);
  }

  // ---------- spawn ----------

  /** Interval spawnu; v zenu pomalejší. */
  private spawnDelay(): number {
    return this.data_.zenMode ? Math.max(this.cfg.spawnMs * 1.6, 4500) : this.cfg.spawnMs;
  }

  private livingZombies(): Zombie[] {
    return this.zombies.filter((z) => !z.dead);
  }

  private fastForwardSpawnTimer() {
    if (this.finished || !this.started || this.isPaused) return;
    const moreToSpawn = this.spawned < this.cfg.count || (this.cfg.boss && !this.bossSpawned);
    if (this.livingZombies().length === 0 && moreToSpawn) {
      const remaining = this.spawnEvent ? this.spawnEvent.getRemaining() : 400;
      if (remaining > 400) {
        if (this.spawnEvent) {
          this.spawnEvent.reset({
            delay: 400,
            callback: () => this.spawnZombie(),
            loop: true,
          });
        } else {
          this.spawnEvent = this.time.addEvent({
            delay: 400,
            callback: () => this.spawnZombie(),
            loop: true,
          });
        }
      }
    }
  }

  private spawnZombie() {
    if (this.finished) return;
    if (this.data_.zenMode) {
      // V Zen režimu se na ploše drží nanejvýš 2 zombíci najednou pro klidné tempo
      const aliveCount = this.zombies.filter((z) => !z.dead).length;
      if (aliveCount >= 2) return;
    }
    if (this.spawned >= this.cfg.count) {
      this.spawnEvent?.remove();
      this.spawnEvent = undefined;
      if (this.cfg.boss && !this.bossSpawned) this.spawnBoss();
      return;
    }
    this.spawned++;
    const r = Math.random();
    const kind: ZombieKind = r < this.cfg.armoredRatio ? "armored" : r < this.cfg.armoredRatio + this.cfg.fastRatio ? "fast" : "basic";
    const word = this.uniqueWord();
    const queue = kind === "armored" ? [this.uniqueWord()] : [];
    this.addZombie(kind, word, queue);

    // Po spawnu vrátíme časovač na standardní interval kola pro dalšího zombíka
    if (this.spawned < this.cfg.count) {
      if (this.spawnEvent) {
        this.spawnEvent.reset({
          delay: this.spawnDelay(),
          callback: () => this.spawnZombie(),
          loop: true,
        });
      } else {
        this.spawnEvent = this.time.addEvent({
          delay: this.spawnDelay(),
          callback: () => this.spawnZombie(),
          loop: true,
        });
      }
    }
  }

  private spawnBoss() {
    this.bossSpawned = true;
    const words = Array.from({ length: this.cfg.bossHp }, () => this.uniqueWord());
    this.addZombie("boss", words[0], words.slice(1));
  }

  /** V jedné chvíli nemají dva zombíci stejné první písmeno (ZType). */
  private uniqueWord(): string {
    const taken = new Set(
      this.zombies
        .filter((z) => !z.dead)
        .map((z) => z.word[0]?.toLowerCase())
        .filter((c): c is string => Boolean(c))
    );
    if (this.activeBoost) taken.add(this.activeBoost.word[0].toLowerCase());
    for (let i = 0; i < 30; i++) {
      const w = this.gen.next(taken);
      if (!taken.has(w[0]?.toLowerCase())) return w;
    }
    return this.gen.next(taken);
  }

  private addZombie(kind: ZombieKind, word: string, queue: string[]) {
    const lane = this.pickLane();
    const y = LANE_TOP + lane * LANE_H + LANE_H - 6;
    const texKey =
      kind === "basic"
        ? Math.random() < 0.5 && this.textures.exists(TEX.zombieStudent)
          ? TEX.zombieStudent
          : TEX.zombieBasic
        : { fast: TEX.zombieFast, armored: TEX.zombieArmored, boss: TEX.boss }[kind];
    const sprite = this.add.image(0, 0, texKey).setOrigin(0.5, 1);
    // jednotná výška postav bez ohledu na rozlišení zdrojového obrázku
    const targetH = { basic: 136, fast: 118, armored: 140, boss: 235 }[kind];
    sprite.setScale(targetH / sprite.height);
    const fontSize = kind === "boss" ? 40 : 30;
    const style = {
      fontFamily: "Consolas, 'Courier New', monospace",
      fontSize: `${fontSize}px`,
      stroke: "#000000",
      strokeThickness: 5,
    };
    const labelBg = this.add.graphics();
    const typedText = this.add.text(0, 0, "", { ...style, color: "#2ecc71" }).setOrigin(0, 1);
    const restText = this.add.text(0, 0, word, { ...style, color: "#ffffff" }).setOrigin(0, 1);
    const container = this.add.container(SPAWN_X, y, [sprite, labelBg, typedText, restText]);
    container.setDepth(10 + lane);

    const speedMul = kind === "fast" ? 1.55 : kind === "boss" ? 0.55 : kind === "armored" ? 0.85 : 1;
    const zenMul = this.data_.zenMode ? (this.data_.zenSpeed ?? 0.35) : 1;
    const z: Zombie = {
      kind,
      lane,
      sprite,
      container,
      labelBg,
      typedText,
      restText,
      word,
      typed: 0,
      speed: ((SPAWN_X - HOUSE_X) / this.cfg.crossSec) * speedMul * zenMul,
      queue,
      hp: 1 + queue.length,
      maxHp: 1 + queue.length,
      dead: false,
      slowUntil: 0,
      stunUntil: 0,
    };
    this.layoutLabel(z);
    if (this.time.now < this.freezeUntil) {
      sprite.setTint(0x74b9ff);
    }
    this.zombies.push(z);

    // houpání při chůzi (procedurální animace místo snímků)
    this.tweens.add({
      targets: sprite,
      angle: { from: -4, to: 4 },
      duration: kind === "fast" ? 220 : 420,
      yoyo: true,
      repeat: -1,
      ease: "Sine.inOut",
    });
    if (kind === "boss") this.cameras.main.shake(300, 0.004);
    this.emitHud();
  }

  private pickLane(): number {
    // dráha s nejmenším počtem živých zombíků, při shodě náhodně
    const counts = Array.from({ length: LANES }, (_, i) => this.livingZombies().filter((z) => z.lane === i).length);
    const min = Math.min(...counts);
    const candidates = counts.map((c, i) => (c === min ? i : -1)).filter((i) => i >= 0);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private layoutLabel(z: Zombie) {
    const typed = z.word.slice(0, z.typed);
    const rest = z.word.slice(z.typed);
    z.typedText.setText(typed);
    z.restText.setText(rest);
    const total = z.typedText.width + z.restText.width;
    const top = -z.sprite.displayHeight - 10;
    z.typedText.setPosition(-total / 2, top);
    z.restText.setPosition(-total / 2 + z.typedText.width, top);

    z.labelBg.clear();
    if (total > 0) {
      const padX = 10;
      const padY = 4;
      const textH = Math.max(z.typedText.height, z.restText.height, z.kind === "boss" ? 44 : 34);
      const pillW = total + padX * 2;
      const pillH = textH + padY * 2;
      const pillX = -total / 2 - padX;
      const pillY = top - textH - padY;
      const radius = 8;
      z.labelBg.fillStyle(0x000000, 0.75);
      z.labelBg.fillRoundedRect(pillX, pillY, pillW, pillH, radius);
      z.labelBg.lineStyle(1.5, 0xffffff, 0.25);
      z.labelBg.strokeRoundedRect(pillX, pillY, pillW, pillH, radius);
    }
  }

  // ---------- vstup ----------

  private onChar(ch: string, tAbs: number) {
    if (this.finished || this.isPaused) return;
    this.events.emit("first-key");
    const t = Math.round(tAbs - this.startAt - this.totalPauseDurationMs);

    // Mezerník nebo Tab přepíná zaměření na bůst
    if (ch === " " || ch === "\t" || ch === "Tab") {
      if (this.activeBoost) {
        this.toggleBoostLock();
      }
      return;
    }

    // 1) Pokud je hráč zamčený na bůst -> klávesy jdou výhradně na bůst
    if (this.boostLocked && this.activeBoost) {
      this.hitBoost(ch, t);
      return;
    }

    // 2) Pokud je hráč zamčený na zombíka
    if (this.locked && !this.locked.dead) {
      this.hit(this.locked, ch, t);
      return;
    }

    // 3) Nový cíl mezi zombíky (nejbližší zombík začínající znakem)
    const target = this.zombies
      .filter((z) => !z.dead && z.word[0] === ch)
      .sort((a, b) => a.container.x - b.container.x)[0];
    if (target) {
      this.setLocked(target);
      this.hit(target, ch, t);
      return;
    }

    // 4) Pokud žádný zombík nezačíná na tento znak, ale aktivní bůst ano
    if (this.activeBoost && this.activeBoost.word[0] === ch) {
      this.boostLocked = true;
      this.hitBoost(ch, t);
      return;
    }

    this.miss(ch, t);
  }

  private onBackspace() {
    if (this.finished || !this.started || this.isPaused) return;
    const now = performance.now();
    const isDoubleTap = now - this.lastBackspaceTime < 350;
    this.lastBackspaceTime = now;

    if (this.locked && !this.locked.dead) {
      if (isDoubleTap) {
        // Okamžité zrušení uzamčení při dvojstisku Backspace
        this.locked.typed = 0;
        this.layoutLabel(this.locked);
        this.setLocked(null);
        this.emitHud();
        return;
      }

      if (this.locked.typed > 0) {
        this.locked.typed--;
        this.layoutLabel(this.locked);
      }

      if (this.locked.typed === 0) {
        this.setLocked(null);
        this.emitHud();
      }
      return;
    }

    if (this.boostLocked && this.activeBoost) {
      if (isDoubleTap || this.activeBoost.typed === 0) {
        this.activeBoost.typed = 0;
        this.boostLocked = false;
      } else {
        this.activeBoost.typed--;
      }
      this.emitHud();
    }
  }

  private setLocked(z: Zombie | null) {
    if (this.locked && this.locked !== z) {
      this.updateZombieHighlight(this.locked, false);
    }
    this.locked = z;
    if (z && !z.dead && z.container.active) {
      this.updateZombieHighlight(z, true);
      this.updateCrosshair();
    } else {
      if (this.crosshair) {
        this.crosshair.setVisible(false);
      }
    }
  }

  private updateZombieHighlight(z: Zombie, isLocked: boolean) {
    if (!z || z.dead || !z.container || !z.container.active) return;
    if (isLocked) {
      // Barva ohraničení podle combo streak (Cyber Glow)
      const glowColor =
        this.combo >= 15
          ? "#ff4757" // Plamen / červená (Ultra)
          : this.combo >= 10
          ? "#2ed573" // Neon zelená (Super)
          : this.combo >= 5
          ? "#1e90ff" // Neon modrá (Good)
          : "#ffd32a"; // Zlatá (Default lock)
      z.typedText.setStroke(glowColor, 7);
      z.restText.setStroke(glowColor, 7);
      z.container.setScale(1.08);
    } else {
      z.typedText.setStroke("#000000", 5);
      z.restText.setStroke("#000000", 5);
      z.container.setScale(1.0);
    }
  }

  private showFloatingScore(x: number, y: number, score: number, combo: number) {
    const isBigCombo = combo >= 5;
    const textStr = isBigCombo ? `+${score}\nCOMBO x${combo}!` : `+${score}`;
    const textColor =
      combo >= 15 ? "#ff4757" : combo >= 10 ? "#2ed573" : combo >= 5 ? "#00f2fe" : "#ffd32a";

    const label = this.add.text(x, y, textStr, {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: isBigCombo ? "13px" : "11px",
      color: textColor,
      align: "center",
      stroke: "#000000",
      strokeThickness: 4,
    });
    label.setOrigin(0.5);
    label.setDepth(250);

    this.tweens.add({
      targets: label,
      y: y - 45,
      alpha: 0,
      scale: isBigCombo ? 1.25 : 1.1,
      duration: 850,
      ease: "Cubic.out",
      onComplete: () => label.destroy(),
    });
  }

  private createCrosshair() {
    const g = this.add.graphics();
    const size = 18;
    const arm = 8;
    g.lineStyle(2.5, 0x00f2fe, 0.95);

    // Horní levý roh
    g.lineBetween(-size, -size + arm, -size, -size);
    g.lineBetween(-size, -size, -size + arm, -size);

    // Horní pravý roh
    g.lineBetween(size - arm, -size, size, -size);
    g.lineBetween(size, -size, size, -size + arm);

    // Dolní levý roh
    g.lineBetween(-size, size - arm, -size, size);
    g.lineBetween(-size, size, -size + arm, size);

    // Dolní pravý roh
    g.lineBetween(size - arm, size, size, size);
    g.lineBetween(size, size, size, size - arm);

    // Vnitřní zaměřovací kroužek (zlatý)
    g.lineStyle(1.5, 0xffd32a, 0.85);
    g.strokeCircle(0, 0, 8);

    // Středový bod (azurový)
    g.fillStyle(0x00f2fe, 1);
    g.fillCircle(0, 0, 2.5);

    // Křížové rysky
    g.lineStyle(1.5, 0x00f2fe, 0.6);
    g.lineBetween(-size - 3, 0, -size + 3, 0);
    g.lineBetween(size - 3, 0, size + 3, 0);
    g.lineBetween(0, -size - 3, 0, -size + 3);
    g.lineBetween(0, size - 3, 0, size + 3);

    this.crosshair = this.add.container(0, 0, [g]);
    this.crosshair.setDepth(200);
    this.crosshair.setVisible(false);

    // Pulzující animace
    this.tweens.add({
      targets: this.crosshair,
      scale: { from: 1.0, to: 1.15 },
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private updateCrosshair() {
    if (this.crosshair && this.locked && !this.locked.dead && this.locked.container.active) {
      const targetH = this.locked.sprite.displayHeight;
      this.crosshair.setVisible(true);
      this.crosshair.setPosition(this.locked.container.x, this.locked.container.y - targetH - 35);
    } else if (this.crosshair) {
      this.crosshair.setVisible(false);
    }
  }

  private toggleBoostLock(force?: boolean) {
    if (!this.activeBoost || this.finished) return;
    const nextLocked = force !== undefined ? force : !this.boostLocked;
    this.boostLocked = nextLocked;
    if (!this.boostLocked) this.activeBoost.typed = 0;
    if (this.boostLocked) {
      if (this.locked) {
        this.locked.typed = 0;
        this.layoutLabel(this.locked);
        this.setLocked(null);
      }
    }
    this.emitHud();
  }

  private hit(z: Zombie, ch: string, t: number) {
    const expected = z.word[z.typed];
    if (ch === expected) {
      soundManager.playKeystroke(this.combo);
      this.registerKey(expected, true, t);
      z.typed++;
      this.layoutLabel(z);
      this.tweens.add({ targets: z.sprite, scaleX: 0.9, scaleY: 1.08, duration: 60, yoyo: true });
      if (z.typed >= z.word.length) {
        this.wordDone(z);
      } else {
        this.emitHud();
      }
    } else {
      soundManager.playTypo();
      this.registerKey(expected, false, t);
      this.tweens.add({ targets: z.container, x: z.container.x + 6, duration: 40, yoyo: true, repeat: 2 });
    }
  }

  private wordDone(z: Zombie) {
    const base = 10 * z.word.length;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const addedScore = base + Math.min(this.combo, 10) * 5;
    this.score += addedScore;

    // Vizuální plovoucí skóre a combo text
    this.showFloatingScore(z.container.x, z.container.y - 40, addedScore, this.combo);

    z.hp--;
    if (z.queue.length > 0) {
      // boss / obrněný: další slovo
      let nextW = z.queue.shift()!;
      if (this.activeBoost && nextW[0]?.toLowerCase() === this.activeBoost.word[0]?.toLowerCase()) {
        nextW = this.uniqueWord();
      }
      z.word = nextW;
      z.typed = 0;
      this.layoutLabel(z);
      this.flash(z);
      this.setLocked(null);
      this.emitHud();
      return;
    }
    this.kill(z);
    this.setLocked(null);
    this.killsSinceBoost++;
    if (!this.activeBoost && this.killsSinceBoost >= (this.cfg.bonusEvery || 3)) {
      this.killsSinceBoost = 0;
      this.offerBoost();
    }
  }

  private kill(z: Zombie) {
    z.dead = true;
    if (this.locked === z) {
      this.locked = null;
    }
    this.kills++;
    soundManager.playZombieDefeat();
    this.updateZombieHighlight(z, false);
    this.tweens.killTweensOf(z.sprite);
    this.tweens.killTweensOf(z.container);
    this.tweens.add({
      targets: z.container,
      angle: 90,
      alpha: 0,
      y: z.container.y + 30,
      duration: 350,
      ease: "Quad.in",
      onComplete: () => z.container.destroy(),
    });
    this.emitHud();
    if (this.data_.zenMode && this.spawned < this.cfg.count) {
      this.time.delayedCall(1000, () => {
        if (!this.finished) this.spawnZombie();
      });
    }
    this.checkEnd();
    this.fastForwardSpawnTimer();
  }

  private flash(z: Zombie) {
    z.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(80, () => {
      if (z.sprite.active) {
        if (this.time.now < this.freezeUntil || (z.slowUntil && this.time.now < z.slowUntil)) {
          z.sprite.setTint(0x74b9ff).setTintMode(Phaser.TintModes.MULTIPLY);
        } else {
          z.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
        }
      }
    });
  }

  private miss(ch: string, t: number) {
    soundManager.playTypo();
    this.registerKey(ch, false, t);
    this.combo = 0;
    this.cameras.main.shake(100, 0.004);
    // Vizuální varovný záblesk při chybě (červený flash)
    this.cameras.main.flash(180, 255, 60, 60, false);

    // Zvýšení rychlosti zombíků jako trest za chybu (trvá 2.5s)
    this.errorSpeedBoostUntil = Math.max(this.errorSpeedBoostUntil, this.time.now) + 2500;

    // Pokud je aktivní zombík uzamčen nebo existují zombíci, posunout je mírně vpřed (skok o 12 px)
    for (const z of this.zombies) {
      if (!z.dead) {
        z.container.x -= 12;
      }
    }

    this.showPenaltyNotice();
  }

  private showPenaltyNotice() {
    const notice = this.add.text(this.scale.width / 2, 75, "⚠️ CHYBA! ZRYCHLENÍ ZOMBÍKŮ! ⚠️", {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: "13px",
      color: "#ff3838",
      stroke: "#000000",
      strokeThickness: 4,
    });
    notice.setOrigin(0.5);
    notice.setDepth(300);

    this.tweens.add({
      targets: notice,
      y: 55,
      alpha: 0,
      duration: 1200,
      ease: "Quad.out",
      onComplete: () => notice.destroy(),
    });
  }

  private registerKey(key: string, ok: boolean, t: number) {
    const k = key.toLowerCase();
    const s = (this.keyStats[k] ??= { hits: 0, misses: 0 });
    if (ok) {
      s.hits++;
      this.correct++;
    } else {
      s.misses++;
      this.errors++;
      this.combo = 0;
    }
    this.keystrokes.push([t, ok ? 1 : 0]);
  }

  // ---------- bůsty a věže ----------

  private offerBoost() {
    if (this.finished || this.activeBoost) return;
    const types: BoostType[] = [
      "turret",
      "turret_ice",
      "turret_knockback",
      "turret_explosive",
      "bomb",
      "freeze",
    ];
    if (this.lives < 5) types.push("heal", "heal");
    const type = types[Math.floor(Math.random() * types.length)];
    const word = this.uniqueBoostWord();
    const meta: Record<BoostType, { title: string; icon: string }> = {
      turret: { title: "Tureta", icon: "🌱" },
      turret_ice: { title: "Mrazivá střílna", icon: "❄️" },
      turret_knockback: { title: "Odstrkovadlo", icon: "🥊" },
      turret_explosive: { title: "Výbušná věž", icon: "🧨" },
      bomb: { title: "Bomba", icon: "💣" },
      freeze: { title: "Mrazák", icon: "🧊" },
      heal: { title: "Oprava", icon: "❤️" },
    };
    this.activeBoost = {
      type,
      title: meta[type].title,
      icon: meta[type].icon,
      word,
      typed: 0,
    };
    this.boostLocked = false;
    this.emitHud();
  }

  private uniqueBoostWord(): string {
    const taken = new Set(
      this.zombies
        .filter((z) => !z.dead)
        .map((z) => z.word[0]?.toLowerCase())
        .filter((c): c is string => Boolean(c))
    );
    for (let i = 0; i < 30; i++) {
      const w = this.gen.boostWord(taken);
      if (!taken.has(w[0]?.toLowerCase())) return w;
    }
    return this.gen.boostWord(taken);
  }

  private hitBoost(ch: string, t: number) {
    if (!this.activeBoost) return;
    const expected = this.activeBoost.word[this.activeBoost.typed];
    if (ch === expected) {
      soundManager.playKeystroke(this.combo);
      this.registerKey(expected, true, t);
      this.activeBoost.typed++;
      if (this.activeBoost.typed >= this.activeBoost.word.length) {
        const type = this.activeBoost.type;
        this.activeBoost = null;
        this.boostLocked = false;
        // body dřív než efekt: bomba může zabít posledního zombíka a ukončit kolo
        this.score += 50;
        this.triggerBoost(type);
      }
    } else {
      soundManager.playTypo();
      this.registerKey(expected, false, t);
      this.activeBoost.typed = 0;
      this.cameras.main.shake(80, 0.002);
    }
    this.emitHud();
  }

  private triggerBoost(type: BoostType) {
    switch (type) {
      case "turret":
        this.placeTower("basic");
        break;
      case "turret_ice":
        this.placeTower("ice");
        break;
      case "turret_knockback":
        this.placeTower("knockback");
        break;
      case "turret_explosive":
        this.placeTower("explosive");
        break;
      case "bomb":
        this.detonateBomb();
        break;
      case "freeze":
        this.activateFreeze();
        break;
      case "heal":
        this.healBase();
        break;
    }
    this.emitHud();
  }

  private showFloatingText(x: number, y: number, text: string, color = "#2ecc71") {
    const t = this.add
      .text(x, y, text, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "26px",
        fontStyle: "bold",
        color,
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({
      targets: t,
      y: y - 50,
      alpha: 0,
      duration: 900,
      ease: "Cubic.out",
      onComplete: () => t.destroy(),
    });
  }

  public placeTower(kind: TurretKind = "basic") {
    // Dráha s nejvíce živými zombíky
    const counts = Array.from({ length: LANES }, (_, i) => this.zombies.filter((z) => !z.dead && z.lane === i).length);
    const maxZombies = Math.max(...counts);
    const candidates = counts.map((c, i) => (c === maxZombies ? i : -1)).filter((i) => i >= 0);
    const lane = candidates[Math.floor(Math.random() * candidates.length)];

    const y = LANE_TOP + lane * LANE_H + LANE_H - 6;
    const existingOnLane = this.towers.filter((tw) => tw.lane === lane).length;
    const posX = HOUSE_X + 65 + existingOnLane * 50;

    const sprite = this.add.image(posX, y, TEX.tower).setOrigin(0.5, 1).setDepth(5);
    const towerScale = 116 / sprite.height;

    const tintColors: Record<TurretKind, number> = {
      basic: 0x2ecc71,
      ice: 0x74b9ff,
      knockback: 0xe67e22,
      explosive: 0xff4757,
    };
    sprite.setTint(tintColors[kind]).setTintMode(Phaser.TintModes.MULTIPLY);

    this.tweens.add({ targets: sprite, scale: { from: 0, to: towerScale }, duration: 280, ease: "Back.out" });

    const lifespan = kind === "explosive" ? 25000 : kind === "basic" ? 22000 : 20000;
    const initialDelay = kind === "explosive" ? 400 : kind === "ice" ? 500 : 600;

    this.towers.push({
      kind,
      lane,
      sprite,
      expiresAt: this.time.now + lifespan,
      nextShotAt: this.time.now + initialDelay,
    });

    const floatingConfig: Record<TurretKind, { text: string; color: string }> = {
      basic: { text: "🌱 TURETA!", color: "#2ecc71" },
      ice: { text: "❄️ MRAZIVÁ TURETA!", color: "#74b9ff" },
      knockback: { text: "🥊 ODSTRKOVADLO!", color: "#e67e22" },
      explosive: { text: "🧨 VÝBUŠNÁ VĚŽ!", color: "#ff4757" },
    };
    this.showFloatingText(posX, y - 85, floatingConfig[kind].text, floatingConfig[kind].color);
    this.cameras.main.shake(120, 0.003);
  }

  private detonateBomb() {
    // Najdi nejohroženější dráhu (zombík nejblíže domu)
    const living = this.zombies.filter((z) => !z.dead);
    const sortedByThreat = [...living].sort((a, b) => a.container.x - b.container.x);
    const threat = sortedByThreat[0];
    const lane = threat ? threat.lane : Math.floor(Math.random() * LANES);
    const bombX = threat ? Math.min(threat.container.x, W - 140) : W / 2;
    const bombY = LANE_TOP + lane * LANE_H + LANE_H / 2;

    this.cameras.main.shake(350, 0.015);
    this.cameras.main.flash(150, 255, 90, 40);

    // Animace exploze
    const g = this.add.graphics().setDepth(30);
    this.tweens.addCounter({
      from: 10,
      to: 180,
      duration: 380,
      ease: "Quad.out",
      onUpdate: (tween) => {
        g.clear();
        const r = tween.getValue() ?? 10;
        const a = 1 - r / 180;
        g.fillStyle(0xff4757, a * 0.7);
        g.fillCircle(bombX, bombY, r);
        g.lineStyle(5, 0xffa502, a);
        g.strokeCircle(bombX, bombY, r * 1.05);
      },
      onComplete: () => g.destroy(),
    });

    this.showFloatingText(bombX, bombY - 45, "💥 BUM!", "#ff4757");

    // Znič nebo těžce zraň zombíky v této dráze
    const laneZombies = this.zombies.filter((z) => !z.dead && z.lane === lane);
    for (const z of laneZombies) {
      if (Math.abs(z.container.x - bombX) < 260) {
        if (z.kind === "boss") {
          z.hp -= 2;
          if (z.hp <= 0) {
            this.score += 50;
            this.kill(z);
          } else {
            z.queue.splice(0, Math.min(2, z.queue.length));
            this.flash(z);
          }
        } else {
          this.score += 25;
          this.kill(z);
        }
      }
    }
  }

  private activateFreeze() {
    this.freezeUntil = this.time.now + 6000;
    this.cameras.main.flash(200, 100, 200, 255);
    this.showFloatingText(W / 2, H / 2 - 30, "❄️ ZMRAZENO!", "#74b9ff");

    for (const z of this.zombies) {
      if (!z.dead) {
        z.sprite.setTint(0x74b9ff).setTintMode(Phaser.TintModes.MULTIPLY);
      }
    }

    this.time.delayedCall(6000, () => {
      if (this.time.now >= this.freezeUntil) {
        for (const z of this.zombies) {
          if (!z.dead && z.sprite.active) {
            // po mrazu zůstane modrá jen zpomaleným zombíkům (ledová tureta)
            if (z.slowUntil && this.time.now < z.slowUntil) z.sprite.setTint(0x74b9ff).setTintMode(Phaser.TintModes.MULTIPLY);
            else z.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
          }
        }
      }
    });
  }

  private healBase() {
    this.lives = Math.min(5, this.lives + 1);
    this.livesLost = Math.max(0, this.livesLost - 1);
    this.cameras.main.flash(150, 46, 204, 113);
    this.showFloatingText(HOUSE_X + 50, LANE_TOP + LANE_H, "+1 ❤", "#e74c3c");
  }

  private updateTowers() {
    for (const tw of this.towers) {
      if (this.time.now >= tw.expiresAt) {
        if (tw.sprite && tw.sprite.active) {
          this.tweens.add({
            targets: tw.sprite,
            alpha: 0,
            duration: 300,
            onComplete: () => {
              if (tw.sprite.active) tw.sprite.destroy();
            },
          });
        }
        continue;
      }
      if (this.time.now < tw.nextShotAt) continue;

      const target = this.zombies
        .filter((z) => !z.dead && z.lane === tw.lane && z.container.x <= W - 20)
        .sort((a, b) => a.container.x - b.container.x)[0];
      if (!target) continue;

      if (tw.kind === "basic") {
        tw.nextShotAt = this.time.now + 1600;
      } else if (tw.kind === "ice") {
        tw.nextShotAt = this.time.now + 2000;
      } else if (tw.kind === "knockback") {
        tw.nextShotAt = this.time.now + 2400;
      } else if (tw.kind === "explosive") {
        // Jednorázová věž: po výstřelu se okamžitě sebedestruuje
        tw.expiresAt = 0;
        const twSprite = tw.sprite;
        this.tweens.add({
          targets: twSprite,
          scale: 0,
          alpha: 0,
          duration: 350,
          ease: "Back.in",
          onComplete: () => {
            this.tweens.killTweensOf(twSprite);
            if (twSprite.active) twSprite.destroy();
          },
        });
      }

      // Zpětný ráz věže
      if (tw.sprite.active) {
        this.tweens.add({ targets: tw.sprite, x: tw.sprite.x - 4, duration: 60, yoyo: true });
      }

      soundManager.playTowerShot();

      const bulletX = tw.sprite.x + 20;
      const bulletY = tw.sprite.y - tw.sprite.displayHeight * 0.65;
      const bullet = this.add.image(bulletX, bulletY, TEX.bullet).setDepth(20);

      const bulletTints: Record<TurretKind, number> = {
        basic: 0x2ecc71,
        ice: 0x74b9ff,
        knockback: 0xe67e22,
        explosive: 0xff4757,
      };
      const bulletScales: Record<TurretKind, number> = {
        basic: 1.0,
        ice: 1.2,
        knockback: 1.3,
        explosive: 1.6,
      };

      bullet.setTint(bulletTints[tw.kind]).setTintMode(Phaser.TintModes.MULTIPLY);
      bullet.setScale(bulletScales[tw.kind]);

      const turretKind = tw.kind;

      this.tweens.add({
        targets: bullet,
        x: target.container.x,
        duration: 220,
        onComplete: () => {
          bullet.destroy();

          if (turretKind === "explosive") {
            const impactX = target.container ? target.container.x : target.sprite.x;
            const impactY = target.container ? target.container.y : target.sprite.y;

            // Animovaný explozivní kruh
            const g = this.add.graphics().setDepth(30);
            this.tweens.addCounter({
              from: 10,
              to: 140,
              duration: 350,
              ease: "Quad.out",
              onUpdate: (tween) => {
                g.clear();
                const r = tween.getValue() ?? 10;
                const a = 1 - r / 140;
                g.fillStyle(0xff4757, a * 0.7);
                g.fillCircle(impactX, impactY, r);
                g.lineStyle(5, 0xffa502, a);
                g.strokeCircle(impactX, impactY, r * 1.05);
              },
              onComplete: () => g.destroy(),
            });

            this.cameras.main.shake(200, 0.008);
            this.showFloatingText(impactX, impactY - 60, "💥 BUM!", "#ff4757");

            if (target.dead) return;

            if (target.kind === "boss") {
              const dmg = Math.min(4, target.hp);
              for (let d = 0; d < dmg - 1; d++) {
                if (target.queue.length > 0) target.queue.shift();
              }
              target.hp -= dmg;
              if (target.hp <= 0) {
                target.queue = [];
                this.kill(target);
              } else {
                if (target.queue.length > 0) {
                  target.word = target.queue.shift()!;
                  target.typed = 0;
                }
                this.layoutLabel(target);
                this.flash(target);
              }
            } else {
              target.queue = [];
              target.hp = 0;
              this.score += 50;
              if (this.locked === target) this.locked = null;
              this.kill(target);
            }
            return;
          }

          if (target.dead) return;

          if (turretKind === "knockback") {
            const newX = Math.min(W, target.container.x + 120);
            this.tweens.add({
              targets: target.container,
              x: newX,
              duration: 200,
              ease: "Cubic.out",
            });
            target.stunUntil = Math.max(target.stunUntil ?? 0, this.time.now + 400);
            this.flash(target);
            this.cameras.main.shake(80, 0.002);
            this.showFloatingText(target.container.x, target.container.y - 60, "🥊 ZPĚT!", "#e67e22");
            return;
          }

          if (turretKind === "ice") {
            const slowDuration = 3500;
            target.slowUntil = Math.max(target.slowUntil ?? 0, this.time.now + slowDuration);
            target.sprite.setTint(0x74b9ff).setTintMode(Phaser.TintModes.MULTIPLY);

            this.time.delayedCall(slowDuration, () => {
              if (
                !target.dead &&
                target.sprite.active &&
                this.time.now >= (target.slowUntil ?? 0) &&
                this.time.now >= this.freezeUntil
              ) {
                target.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
              }
            });

            if (target.word.length - target.typed > 1) {
              target.word = target.word.slice(0, -1);
              this.layoutLabel(target);
              this.flash(target);
              this.showFloatingText(target.container.x, target.container.y - 60, "❄️ -1", "#74b9ff");
            } else {
              this.score += 15;
              this.wordDone(target);
            }
            return;
          }

          // Základní věž: ubourání jednoho znaku
          if (target.word.length - target.typed > 1) {
            target.word = target.word.slice(0, -1);
            this.layoutLabel(target);
            this.flash(target);
            this.showFloatingText(target.container.x, target.container.y - 60, "-1", "#2ecc71");
          } else {
            this.score += 15;
            this.wordDone(target);
          }
        },
      });
    }
    this.towers = this.towers.filter((tw) => this.time.now < tw.expiresAt);
  }

  // ---------- smyčka ----------

  update(_time: number, delta: number) {
    if (this.finished || !this.started || this.isPaused) return;
    const dt = delta / 1000;
    const isFrozen = this.time.now < this.freezeUntil;
    const isPenaltySpeed = this.time.now < this.errorSpeedBoostUntil;
    const penaltyMul = isPenaltySpeed ? 1.45 : 1; // +45% rychlost zombíků po chybě

    for (const z of this.zombies) {
      if (z.dead) continue;
      let speedMul = (isFrozen ? 0.35 : 1) * penaltyMul;
      if (z.stunUntil && this.time.now < z.stunUntil) {
        speedMul = 0;
      } else if (z.slowUntil && this.time.now < z.slowUntil) {
        speedMul *= 0.5;
      }
      z.container.x -= z.speed * dt * speedMul;
      if (z.container.x <= HOUSE_X) this.reachedHouse(z);
    }
    this.updateTowers();
    this.updateCrosshair();
    this.hudTimer += delta;
    if (this.hudTimer > 200) {
      this.hudTimer = 0;
      this.emitHud();
    }
  }

  private reachedHouse(z: Zombie) {
    if (this.data_.zenMode) {
      // V Zen režimu zombík resetuje svou pozici na začátek dráhy a neubírá životy (žádná prohra)
      z.container.x = SPAWN_X;
      this.cameras.main.shake(80, 0.002);
      this.flash(z);
      this.emitHud();
      return;
    }

    const damage = z.kind === "boss" ? 3 : 1;
    this.lives = Math.max(0, this.lives - damage);
    this.livesLost += damage;
    this.combo = 0;
    if (this.locked === z) this.setLocked(null);
    z.dead = true;
    soundManager.playHouseBreach();
    this.tweens.killTweensOf(z.sprite);
    this.tweens.killTweensOf(z.container);
    z.container.destroy();
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(150, 200, 30, 30);
    this.emitHud();
    if (this.lives <= 0) this.finish(false);
    else {
      this.checkEnd();
      this.fastForwardSpawnTimer();
    }
  }

  private checkEnd() {
    if (this.finished) return;
    const alive = this.livingZombies().length > 0;
    const moreToSpawn = this.spawned < this.cfg.count || (this.cfg.boss && !this.bossSpawned);
    if (!alive && !moreToSpawn) this.finish(true);
  }

  private finish(won: boolean) {
    if (this.finished) return;
    this.finished = true;
    if (this.isPaused && this.pauseStartAt > 0) {
      const pauseDelta = performance.now() - this.pauseStartAt;
      this.totalPauseDurationMs += pauseDelta;
      this.pauseStartAt = 0;
      this.isPaused = false;
      bridge.emitTyped("pause-state", false);
    }
    this.setLocked(null);
    this.spawnEvent?.remove();
    this.startTimer?.remove();
    this.input_.disableCapture();
    this.tweens.pauseAll();
    if (won) {
      soundManager.playVictory();
    } else {
      soundManager.playDefeat();
    }
    const durationMs = Math.max(1, Math.round(performance.now() - this.startAt - this.totalPauseDurationMs));
    const m = { correct: this.correct, errors: this.errors, durationMs };
    const acc = accuracy(m);
    const result: RunResult = {
      levelId: levelId(this.data_.chapter, this.data_.round),
      chapter: this.data_.chapter,
      round: this.data_.round,
      won,
      correct: this.correct,
      errors: this.errors,
      durationMs,
      cpm: grossCpm(m),
      netCpm: netCpm(m),
      accuracy: acc,
      stars: stars(won, acc),
      score: this.score + (won ? 100 + this.lives * 20 : 0),
      livesLost: this.livesLost,
      kills: this.kills,
      maxCombo: this.maxCombo,
      keyStats: this.keyStats,
      keystrokes: this.keystrokes,
      zenMode: !!this.data_.zenMode,
    };
    const titleMsg = this.data_.zenMode ? "Kolo dokončeno! 🧘" : won ? "Kolo vyhráno!" : "Zombíci prošli…";
    this.add
      .text(W / 2, H / 2, titleMsg, {
        fontFamily: "system-ui, sans-serif",
        fontSize: "56px",
        color: won ? "#2ecc71" : "#e74c3c",
        stroke: "#000000",
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.emitHud();
    bridge.emitTyped("run-finished", result);
  }

  private togglePause() {
    if (this.finished) return;
    this.setPaused(!this.isPaused);
  }

  private setPaused(paused: boolean) {
    if (this.finished || this.isPaused === paused) return;
    this.isPaused = paused;

    if (paused) {
      this.pauseStartAt = performance.now();
      if (this.spawnEvent) this.spawnEvent.paused = true;
      if (this.startTimer) this.startTimer.paused = true;
      // zastaví i delayedCall (konec mrazu, zpomalení, nabídka bůstu, zen spawn)
      this.time.paused = true;
      this.tweens.pauseAll();
      this.input_.setPaused(true);
      bridge.emitTyped("pause-state", true);
    } else {
      if (this.pauseStartAt > 0) {
        const pauseDelta = performance.now() - this.pauseStartAt;
        this.totalPauseDurationMs += pauseDelta;
        this.pauseStartAt = 0;
        for (const tw of this.towers) {
          tw.expiresAt += pauseDelta;
          tw.nextShotAt += pauseDelta;
        }
        if (this.freezeUntil > 0) this.freezeUntil += pauseDelta;
        for (const z of this.zombies) {
          if (z.slowUntil) z.slowUntil += pauseDelta;
          if (z.stunUntil) z.stunUntil += pauseDelta;
        }
      }
      this.time.paused = false;
      if (this.spawnEvent) this.spawnEvent.paused = false;
      if (this.startTimer) this.startTimer.paused = false;
      this.tweens.resumeAll();
      this.input_.setPaused(false);
      bridge.emitTyped("pause-state", false);
    }
  }

  private restartLevel() {
    if (this.isPaused) {
      this.setPaused(false);
    }
    bridge.emitTyped("pause-state", false);
    this.scene.restart(this.data_);
  }

  private exit() {
    bridge.emitTyped("exit");
  }

  private calculateCurrentWpm(): number {
    if (!this.started || this.finished) return 0;
    const now = performance.now();
    const windowMs = 5000; // plovoucí okno 5 sekund
    const recentHits = this.keystrokes.filter(([t, ok]) => ok === 1 && now - t <= windowMs).length;
    // 5 úhozů = 1 slovo, okno 5 sekund -> přepočet na minutu: (hits / 5) * (60 / 5) = hits * 2.4
    return Math.round(recentHits * 2.4);
  }

  private emitHud() {
    const boss = this.zombies.find((z) => z.kind === "boss" && !z.dead);
    const expectedChar = this.finished
      ? null
      : this.boostLocked && this.activeBoost
      ? (this.activeBoost.word[this.activeBoost.typed] ?? null)
      : this.locked && !this.locked.dead
      ? (this.locked.word[this.locked.typed] ?? null)
      : (this.zombies
          .filter((z) => !z.dead)
          .sort((a, b) => a.container.x - b.container.x)[0]?.word[0] ?? null);
    const boost: BoostState | null = this.activeBoost
      ? {
          type: this.activeBoost.type,
          title: this.activeBoost.title,
          icon: this.activeBoost.icon,
          word: this.activeBoost.word,
          typed: this.activeBoost.typed,
          locked: this.boostLocked,
        }
      : null;

    const state: HudState = {
      lives: this.lives,
      score: this.score,
      combo: this.combo,
      remaining: this.cfg.count - this.spawned + this.livingZombies().length + (this.cfg.boss && !this.bossSpawned ? 1 : 0),
      bonusWord: this.activeBoost?.word ?? null,
      bonusTyped: this.activeBoost?.typed ?? 0,
      boost,
      boss: boss ? { hp: boss.hp, maxHp: boss.maxHp } : null,
      expectedChar,
      muted: soundManager.isMuted(),
      currentWpm: this.calculateCurrentWpm(),
    };
    bridge.emitTyped("hud", state);
  }
}
