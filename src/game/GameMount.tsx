"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { soundManager } from "./audio/soundManager";
import { bridge } from "./bridge";
import { chapterById } from "./content/curriculum";
import { loadWords, type KeyStat } from "./content/words";
import type { HudState, RunResult } from "./types";
import { FingeringDiagram } from "@/components/FingeringDiagram";

interface Props {
  chapter: number;
  round: number;
  keyStats: Record<string, KeyStat>;
  playerCpm: number;
  layout?: "qwertz" | "qwerty";
  zenMode?: boolean;
  zenSpeed?: number;
  onFinished: (result: RunResult) => void;
  onExit: () => void;
  resultOverlay?: React.ReactNode;
}

/**
 * Obal Phaseru pro React: vytvoří hru v useEffect, zničí ji při odmountování.
 * HUD kreslí React nad canvasem podle událostí z mostu (max. 5× za sekundu).
 */
export default function GameMount({
  chapter,
  round,
  keyStats,
  playerCpm,
  layout,
  zenMode,
  zenSpeed,
  onFinished,
  onExit,
  resultOverlay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [damaged, setDamaged] = useState(false);
  const prevLivesRef = useRef<number | null>(null);
  const finishedRef = useRef(onFinished);
  const exitRef = useRef(onExit);
  finishedRef.current = onFinished;
  exitRef.current = onExit;

  useEffect(() => {
    setMuted(soundManager.isMuted());
    const offMute = soundManager.addListener(setMuted);
    return () => {
      offMute();
    };
  }, []);

  useEffect(() => {
    if (hud?.lives !== undefined) {
      if (prevLivesRef.current !== null && hud.lives < prevLivesRef.current) {
        setDamaged(true);
        const timer = setTimeout(() => setDamaged(false), 500);
        return () => clearTimeout(timer);
      }
      prevLivesRef.current = hud.lives;
    }
  }, [hud?.lives]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element };
      const isFs = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      setIsFullscreen(isFs);
      setTimeout(() => {
        gameRef.current?.scale.refresh();
      }, 50);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const el = containerRef.current as (HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    }) | null;

    if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
      if (el?.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el?.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    setIsPaused(false);
    const offHud = bridge.onTyped("hud", setHud);
    const offReady = bridge.onTyped("level-ready", () => setLoading(false));
    const offFinished = bridge.onTyped("run-finished", (r) => finishedRef.current(r));
    const offExit = bridge.onTyped("exit", () => exitRef.current());
    const offPause = bridge.onTyped("pause-state", setIsPaused);

    (async () => {
      const [{ createGame }, words] = await Promise.all([import("./main"), loadWords()]);
      if (cancelled || !parentRef.current) return;
      gameRef.current = createGame(parentRef.current, {
        chapter,
        round,
        words,
        keyStats,
        playerCpm,
        parent: parentRef.current,
        zenMode,
        zenSpeed,
      });
    })();

    return () => {
      cancelled = true;
      offHud();
      offReady();
      offFinished();
      offExit();
      offPause();
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // hra se vytváří jednou pro danou úroveň a režim; keyStats/playerCpm se čtou jen při startu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, round, zenMode, zenSpeed]);

  useEffect(() => {
    if (!isPaused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape, který pauzu právě zapnul (TypingInput ho už zpracoval), ji nesmí hned vypnout
      if (e.defaultPrevented) return;
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        bridge.emitTyped("resume-level");
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        setIsPaused(false);
        bridge.emitTyped("restart-level");
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        exitRef.current();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPaused]);

  const ch = chapterById(chapter);
  const combo = hud?.combo ?? 0;

  return (
    <div
      ref={containerRef}
      className={`mx-auto w-full select-none ${
        isFullscreen
          ? "fixed inset-0 z-50 flex h-screen w-screen flex-col items-center justify-center bg-black"
          : "max-w-[1280px]"
      }`}
    >
      <div
        className={`relative aspect-video w-full ${
          isFullscreen ? "max-h-screen max-w-[calc(100vh*16/9)]" : ""
        }`}
      >
        <div
          ref={parentRef}
          className={`absolute inset-0 overflow-hidden bg-[#1e2a24] shadow-2xl ${
            isFullscreen ? "rounded-none" : "rounded-xl"
          }`}
        />

        {/* Damage flash vignette */}
        {damaged && (
          <div className="pointer-events-none absolute inset-0 z-10 rounded-xl border-4 border-red-500/70 shadow-[inset_0_0_50px_rgba(239,68,68,0.7)] animate-in fade-in duration-100" />
        )}

        {/* In-Game Arcade HUD */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 text-white">
          {/* Left: Chapter pill & Glowing Life Containers */}
          <div className="space-y-1.5 rounded-xl border border-white/10 bg-black/65 px-3.5 py-2.5 backdrop-blur-md shadow-xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Kapitola {chapter} · {ch?.name} · {round === 6 ? "👑 Boss" : `kolo ${round}`}
              {zenMode && (
                <span className="ml-2 inline-flex items-center rounded bg-emerald-700/80 px-1.5 py-0.5 text-xs font-semibold normal-case text-emerald-100">
                  🧘 Zen
                </span>
              )}
            </div>
            {/* Glowing Life Containers (v zenu se životy neztrácí) */}
            {zenMode ? (
              <div className="text-xs font-medium text-emerald-400">Klidný režim · bez časového stresu</div>
            ) : (
            <div
              className={`flex items-center gap-1.5 ${damaged ? "animate-damage-shake" : ""}`}
              aria-label={`Životy: ${hud?.lives ?? "-"}`}
            >
              {Array.from({ length: 5 }, (_, i) => {
                const active = i < (hud?.lives ?? 0);
                return (
                  <div
                    key={i}
                    className="relative flex items-center justify-center transition-all duration-300"
                    style={{
                      filter: active
                        ? "drop-shadow(0 0 6px rgba(239, 68, 68, 0.95)) drop-shadow(0 0 14px rgba(220, 38, 38, 0.6))"
                        : "drop-shadow(0 0 1px rgba(0, 0, 0, 0.8))",
                    }}
                  >
                    <svg
                      className={`h-6 w-6 sm:h-7 sm:w-7 transition-all duration-200 ${
                        active
                          ? "fill-red-500 stroke-red-300 stroke-1 scale-100"
                          : "fill-zinc-900/90 stroke-zinc-700/60 stroke-1 opacity-35 scale-90"
                      }`}
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                    {active && (
                      <span className="absolute top-1.5 left-2 h-1.5 w-1.5 rounded-full bg-white/80 pointer-events-none" />
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>

          {/* Center: Dedicated Arcade Combo Meter */}
          <div className="flex flex-col items-center justify-center pt-1">
            {combo > 0 && (
              <div
                key={combo}
                className={`animate-combo-bounce flex items-center gap-1.5 rounded-full border-2 px-4 py-1.5 font-black uppercase tracking-wider text-sm sm:text-base shadow-2xl backdrop-blur-md transition-all ${
                  combo >= 20
                    ? "animate-ultra-pulse border-yellow-300 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-amber-500 text-yellow-100 shadow-[0_0_25px_rgba(234,179,8,0.8)]"
                    : combo >= 10
                    ? "border-orange-300 bg-gradient-to-r from-orange-600 via-amber-600 to-red-600 text-white shadow-[0_0_20px_rgba(249,115,22,0.7)]"
                    : combo >= 5
                    ? "border-yellow-400 bg-gradient-to-r from-amber-600 to-yellow-600 text-amber-50 shadow-[0_0_15px_rgba(245,158,11,0.5)]"
                    : "border-emerald-400 bg-gradient-to-r from-emerald-800 to-teal-800 text-emerald-100 shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                }`}
              >
                <span>
                  {combo >= 20
                    ? `⚡ ULTRA COMBO x${combo} ⚡`
                    : combo >= 10
                    ? `🔥 COMBO x${combo} 🔥`
                    : combo >= 5
                    ? `✨ KOMBO x${combo}`
                    : `KOMBO x${combo}`}
                </span>
              </div>
            )}
          </div>

          {/* Right: WPM tachometr, restart, pauza, zvuk, skóre */}
          <div className="flex items-start gap-2">
            {/* Živý WPM ukazatel (rychlost psaní) */}
            <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-b from-cyan-950/70 via-zinc-950/85 to-black/90 px-3 py-1.5 text-center backdrop-blur-md shadow-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">Rychlost</div>
              <div className="text-xl font-black tabular-nums tracking-tight text-cyan-200">
                {hud?.currentWpm ?? 0}
                <span className="ml-1 text-[10px] font-normal text-cyan-400/80">WPM</span>
              </div>
            </div>

            {/* Tlačítko rychlého restartu */}
            <button
              type="button"
              onClick={() => bridge.emitTyped("restart-level")}
              aria-label="Restartovat kolo"
              className="pointer-events-auto rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-xl text-zinc-300 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white"
              title="Restartovat kolo (F2)"
            >
              🔄
            </button>
            <button
              type="button"
              onClick={() => bridge.emitTyped("pause-level")}
              aria-label="Pozastavit hru"
              className="pointer-events-auto rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-xl text-zinc-300 backdrop-blur-md transition-colors hover:bg-black/80 hover:text-white"
              title="Pauza (Esc)"
            >
              ⏸
            </button>
            <button
              type="button"
              onClick={() => soundManager.toggleMute()}
              className="pointer-events-auto flex items-center justify-center rounded-xl border border-white/10 bg-black/65 px-3 py-2 text-xl backdrop-blur-md transition hover:bg-black/80 hover:scale-105 active:scale-95 focus:outline-none"
              title={(hud?.muted ?? muted) ? "Zapnout zvuk (SFX)" : "Ztlumit zvuk (SFX)"}
              aria-label={(hud?.muted ?? muted) ? "Zapnout zvuk" : "Ztlumit zvuk"}
            >
              {(hud?.muted ?? muted) ? "🔇" : "🔊"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                toggleFullscreen();
              }}
              aria-label={isFullscreen ? "Ukončit celou obrazovku" : "Celá obrazovka"}
              title={isFullscreen ? "Ukončit celou obrazovku" : "Celá obrazovka"}
              className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-lg bg-black/55 text-zinc-200 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white active:scale-95 cursor-pointer"
            >
              {isFullscreen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                  <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                  <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                  <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                  <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                  <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                  <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                </svg>
              )}
            </button>
          <div className="rounded-xl border border-amber-500/40 bg-gradient-to-b from-amber-950/60 via-zinc-950/85 to-black/90 px-4 py-2 text-right backdrop-blur-md shadow-xl">
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400/80">Skóre</span>
              <span className="text-2xl sm:text-3xl font-black tabular-nums tracking-tight text-amber-300 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
                {hud?.score ?? 0}
              </span>
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-semibold text-zinc-300">
              <span>🧟</span>
              <span>zbývá {hud?.remaining ?? "-"}</span>
            </div>
          </div>
          </div>
        </div>

        {hud?.boost && (
          <div
            onClick={() => {
              bridge.emitTyped("toggle-boost", true);
              parentRef.current?.querySelector("input")?.focus();
            }}
            className={`absolute left-1/2 top-20 z-20 -translate-x-1/2 cursor-pointer select-none transition-all duration-150 ${
              hud.boost.locked
                ? "scale-105 ring-4 ring-emerald-400 border-2 border-emerald-300 shadow-2xl shadow-emerald-500/60 bg-zinc-900/95"
                : "hover:scale-[1.02] ring-1 ring-white/20 hover:ring-emerald-400/50 shadow-lg bg-zinc-900/90"
            } rounded-2xl px-5 py-2.5 backdrop-blur-md`}
          >
            {hud.boost.locked && (
              <>
                {/* Vizuální zaměřovač / rohy cíle */}
                <span className="pointer-events-none absolute -top-1 -left-1 text-emerald-400 font-mono text-xs font-black">⌜</span>
                <span className="pointer-events-none absolute -top-1 -right-1 text-emerald-400 font-mono text-xs font-black">⌝</span>
                <span className="pointer-events-none absolute -bottom-1 -left-1 text-emerald-400 font-mono text-xs font-black">⌞</span>
                <span className="pointer-events-none absolute -bottom-1 -right-1 text-emerald-400 font-mono text-xs font-black">⌟</span>
                {/* Odznak zaměřovače v rohu */}
                <div className="absolute -top-2.5 -right-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 text-zinc-950 shadow-md shadow-emerald-500/50">
                  <svg className="h-3.5 w-3.5 animate-spin" style={{ animationDuration: "6s" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <line x1="12" y1="1" x2="12" y2="5" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="1" y1="12" x2="5" y2="12" />
                    <line x1="19" y1="12" x2="23" y2="12" />
                  </svg>
                </div>
              </>
            )}
            <div className="flex items-center gap-3">
              <span className="text-2xl animate-pulse">{hud.boost.icon}</span>
              <div className="flex flex-col">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                  <span>{hud.boost.title}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] flex items-center gap-1 ${
                      hud.boost.locked
                        ? "bg-emerald-500 text-black font-bold tracking-wide"
                        : "bg-white/10 text-zinc-300"
                    }`}
                  >
                    {hud.boost.locked ? (
                      <>
                        <span>🎯 ZAMČENO · PIŠ SLOVO</span>
                      </>
                    ) : (
                      "MEZERNÍK / TAB = ZAMĚŘIT"
                    )}
                  </span>
                </div>
                <div className="font-mono text-2xl font-bold tracking-wider text-white">
                  <span className="text-emerald-400 underline decoration-2 underline-offset-4">
                    {hud.boost.word.slice(0, hud.boost.typed)}
                  </span>
                  <span className="text-zinc-100 opacity-90">
                    {hud.boost.word.slice(hud.boost.typed)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {hud?.boss && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <div className="w-1/2 rounded-full border border-purple-500/40 bg-black/70 p-1 backdrop-blur-sm shadow-xl">
              <div
                className="h-4 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-500 transition-all shadow-[0_0_10px_rgba(168,85,247,0.7)]"
                style={{ width: `${(hud.boss.hp / hud.boss.maxHp) * 100}%` }}
              />
            </div>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 text-xl text-white">
            Načítám zombíky…
          </div>
        )}

        {/* Pause Modal */}
        {isPaused && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-2xl text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-2xl text-emerald-400">
                ⏸
              </div>
              <h2 className="text-2xl font-bold text-white mb-1">Hra pozastavena</h2>
              <p className="text-sm text-zinc-400 mb-6">
                Kapitola {chapter} · {ch?.name} · kolo {round}
              </p>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => bridge.emitTyped("resume-level")}
                  className="w-full flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow hover:bg-emerald-500 active:scale-[0.99] transition-all cursor-pointer"
                >
                  <span>Pokračovat</span>
                  <kbd className="rounded bg-emerald-700/60 px-2 py-0.5 text-xs text-emerald-100 font-mono">
                    Esc / Enter
                  </kbd>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsPaused(false);
                    bridge.emitTyped("restart-level");
                  }}
                  className="w-full flex items-center justify-between rounded-xl bg-zinc-800 border border-white/5 px-4 py-3 font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white active:scale-[0.99] transition-all cursor-pointer"
                >
                  <span>Restartovat kolo</span>
                  <kbd className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300 font-mono">
                    R
                  </kbd>
                </button>

                <button
                  type="button"
                  onClick={() => exitRef.current()}
                  className="w-full flex items-center justify-between rounded-xl bg-zinc-800/60 border border-white/5 px-4 py-3 font-medium text-zinc-400 hover:bg-red-950/40 hover:text-red-300 hover:border-red-900/30 active:scale-[0.99] transition-all cursor-pointer"
                >
                  <span>Odejít na mapu</span>
                  <kbd className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 font-mono">
                    M
                  </kbd>
                </button>
              </div>
            </div>
          </div>
        )}

        {resultOverlay}
      </div>

      {/* Vizuální nápověda prstokladu pod herním plátnem (v celé obrazovce schovaná) */}
      <div className={isFullscreen ? "hidden" : "mt-3"}>
        <FingeringDiagram expectedChar={hud?.expectedChar} initialLayout={layout} />
      </div>
    </div>
  );
}
