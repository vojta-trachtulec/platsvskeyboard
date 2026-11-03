"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/Kbd";
import { RequireAuth } from "@/components/RequireAuth";
import { CHAPTERS, ROUNDS_PER_CHAPTER, levelId } from "@/game/content/curriculum";
import { useAuth } from "@/lib/auth/AuthContext";
import { getProgress } from "@/lib/firestore/runs";
import type { ProgressDoc } from "@/lib/firestore/types";
import { gradeForCompletion } from "@/lib/grading";
import { useHotkeys } from "@/lib/useHotkeys";

/** První odemčené kolo bez hvězdičky; když je všechno dohrané, poslední kolo kurzu. */
function nextRound(progress: ProgressDoc | null): { chapter: number; round: number; fresh: boolean } {
  const unlocked = progress?.unlockedChapter ?? 1;
  for (const ch of CHAPTERS) {
    if (ch.id > unlocked) break;
    for (let r = 1; r <= ROUNDS_PER_CHAPTER; r++) {
      if ((progress?.levels[levelId(ch.id, r)]?.stars ?? 0) === 0) return { chapter: ch.id, round: r, fresh: true };
    }
  }
  return { chapter: CHAPTERS.length, round: ROUNDS_PER_CHAPTER, fresh: false };
}

export default function HomePage() {
  return (
    <RequireAuth>
      <LevelMap />
    </RequireAuth>
  );
}

function Landing() {
  const router = useRouter();
  useHotkeys({ Enter: () => router.push("/prihlaseni") });
  return (
    <div className="py-16 text-center">
      <div className="mb-4 flex items-end justify-center gap-6" aria-hidden>
        <img src="/game/zombie-teacher.png" alt="" className="h-40 w-auto" />
        <img src="/game/zombie-zelva@320.png" alt="" className="h-32 w-auto" />
        <img src="/game/tower-keyboard-plant@320.png" alt="" className="h-28 w-auto" />
      </div>
      <h1 className="mb-3 text-4xl font-bold">Plants vs. Keyboard</h1>
      <p className="mx-auto mb-8 max-w-xl text-zinc-300">
        Nauč se psát všemi deseti tím, že budeš bránit školu před zombíky. Každý zombík nese písmeno nebo slovo — napiš ho a je po něm.
        Žebříček školy, tříd a na konci možnost nechat si to oznámkovat.
      </p>
      <Link href="/prihlaseni" className="rounded-lg bg-emerald-600 px-6 py-3 text-lg font-semibold hover:bg-emerald-500">
        Přihlásit se školním účtem
        <Kbd>Enter</Kbd>
      </Link>
    </div>
  );
}

interface BiomeTheme {
  name: string;
  subtitle: string;
  badge: string;
  icon: string;
  cardBg: string;
  rimClass: string;
  borderClass: string;
  headerAccent: string;
  starBadgeBg: string;
}

const BIOME_THEMES: Record<string, BiomeTheme> = {
  "Hravý háj": {
    name: "Hravý háj",
    subtitle: "Smaragdový les a první krůčky na domácí řadě (d f j k · a s l ů)",
    badge: "Biom 1 · Lesní háj",
    icon: "🌿",
    cardBg: "bg-gradient-to-b from-emerald-950/85 via-teal-950/60 to-zinc-950/95",
    borderClass: "border-emerald-500/40",
    rimClass: "border-b-[12px] border-b-emerald-900 shadow-[0_25px_60px_-15px_rgba(16,185,129,0.3)]",
    headerAccent: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
    starBadgeBg: "bg-emerald-950/70 border-emerald-500/30 text-emerald-300",
  },
  "Náhorní pláň": {
    name: "Náhorní pláň",
    subtitle: "Větrné skalní hřebeny a výstup na horní řadu kláves (e i · r u · t o)",
    badge: "Biom 2 · Skalní pláň",
    icon: "🏔️",
    cardBg: "bg-gradient-to-b from-amber-950/80 via-slate-900/80 to-zinc-950/95",
    borderClass: "border-amber-500/40",
    rimClass: "border-b-[12px] border-b-amber-950 shadow-[0_25px_60px_-15px_rgba(245,158,11,0.25)]",
    headerAccent: "bg-amber-500/20 text-amber-300 border-amber-400/40",
    starBadgeBg: "bg-amber-950/70 border-amber-500/30 text-amber-300",
  },
  "Psavé údolí": {
    name: "Psavé údolí",
    subtitle: "Meandrující azurová řeka a objevování dolní řady kláves (p c v · m n · y z)",
    badge: "Biom 3 · Říční údolí",
    icon: "🌊",
    cardBg: "bg-gradient-to-b from-cyan-950/80 via-blue-950/60 to-zinc-950/95",
    borderClass: "border-cyan-500/40",
    rimClass: "border-b-[12px] border-b-cyan-950 shadow-[0_25px_60px_-15px_rgba(6,182,212,0.25)]",
    headerAccent: "bg-cyan-500/20 text-cyan-300 border-cyan-400/40",
    starBadgeBg: "bg-cyan-950/70 border-cyan-500/30 text-cyan-300",
  },
  "Země pána Prstů": {
    name: "Země pána Prstů",
    subtitle: "Sopečná pevnost, magmatická zkouška, celá abeceda a klávesa Shift",
    badge: "Biom 4 · Magmatická země",
    icon: "🌋",
    cardBg: "bg-gradient-to-b from-purple-950/80 via-fuchsia-950/50 to-zinc-950/95",
    borderClass: "border-purple-500/40",
    rimClass: "border-b-[12px] border-b-purple-950 shadow-[0_25px_60px_-15px_rgba(168,85,247,0.3)]",
    headerAccent: "bg-purple-500/20 text-purple-300 border-purple-400/40",
    starBadgeBg: "bg-purple-950/70 border-purple-500/30 text-purple-300",
  },
  "Bažina diakritiky": {
    name: "Bažina diakritiky",
    subtitle: "Mlžné bažiny, svítící runy a finále s českou diakritikou (čí · řá · šéú · žýě)",
    badge: "Biom 5 · Finální bažina",
    icon: "🍄",
    cardBg: "bg-gradient-to-b from-lime-950/80 via-emerald-950/60 to-zinc-950/95",
    borderClass: "border-lime-500/40",
    rimClass: "border-b-[12px] border-b-lime-950 shadow-[0_25px_60px_-15px_rgba(132,204,22,0.3)]",
    headerAccent: "bg-lime-500/20 text-lime-300 border-lime-400/40",
    starBadgeBg: "bg-lime-950/70 border-lime-500/30 text-lime-300",
  },
};

function LevelMap() {
  const { user } = useAuth();
  const router = useRouter();
  const [progress, setProgress] = useState<ProgressDoc | null | undefined>(undefined);
  const continueRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (user) getProgress(user.uid).then(setProgress);
  }, [user]);

  const loaded = progress !== undefined;
  const next = nextRound(progress ?? null);
  const nextHref = `/hra?c=${next.chapter}&r=${next.round}`;

  useEffect(() => {
    if (loaded) continueRef.current?.focus({ preventScroll: true });
  }, [loaded]);

  useHotkeys({ Enter: () => router.push(nextHref) }, { enabled: loaded });

  if (!loaded) return <p className="py-20 text-center text-zinc-400">Načítám postup…</p>;

  const completion = progress?.courseCompletion ?? 0;
  const unlocked = progress?.unlockedChapter ?? 1;
  const grade = gradeForCompletion(completion);
  const regions = [...new Set(CHAPTERS.map((c) => c.region))];

  return (
    <div className="space-y-10">
      {/* World Map Header HUD */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 shadow-2xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span>🗺️ Klávesvět</span>
              <span>·</span>
              <span>5 plovoucích ostrovů</span>
            </div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white">Mapa Klávesvěta</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Kurz splněn na <b className="text-white">{completion} %</b>
              {grade ? (
                <>
                  {" "}
                  · aktuálně by ti vyšla známka <b className="text-white">{grade}</b>
                </>
              ) : (
                " · na známku je potřeba 10 %"
              )}
              {progress && (
                <>
                  {" "}
                  · nejlepší {progress.bestNetCpm} čistých úhozů/min
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/profil" className="text-sm font-medium text-emerald-400 hover:underline">
              Profil a známka →
            </Link>
            <Link
              ref={continueRef}
              href={nextHref}
              className="group flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3 font-semibold text-white shadow-lg shadow-emerald-600/30 transition-all hover:scale-[1.02] hover:from-emerald-500 hover:to-teal-500"
            >
              <span>
                {next.fresh ? "Pokračovat" : "Hrát znovu"}: kapitola {next.chapter},{" "}
                {next.round === ROUNDS_PER_CHAPTER ? "boss 👑" : `kolo ${next.round}`}
              </span>
              <Kbd>Enter</Kbd>
            </Link>
          </div>
        </div>
        <div className="mt-4 h-3.5 overflow-hidden rounded-full bg-zinc-800/80 p-0.5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 transition-all duration-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]"
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      {/* 5 Floating Island Biomes */}
      <div className="space-y-12">
        {regions.map((region) => {
          const theme = BIOME_THEMES[region] ?? {
            name: region,
            subtitle: "Dobrodružství v Klávesvětě",
            badge: "Biom",
            icon: "🏝️",
            cardBg: "bg-zinc-900",
            borderClass: "border-white/10",
            rimClass: "border-b-[12px] border-b-zinc-950 shadow-2xl",
            headerAccent: "bg-white/10 text-white border-white/20",
            starBadgeBg: "bg-zinc-800 text-zinc-300 border-white/10",
          };

          const chaptersInRegion = CHAPTERS.filter((c) => c.region === region);
          const regionLocked = chaptersInRegion.length > 0 && chaptersInRegion[0].id > unlocked;
          const totalRegionStars = chaptersInRegion.reduce((sum, ch) => {
            const stars = Array.from(
              { length: ROUNDS_PER_CHAPTER },
              (_, i) => progress?.levels[levelId(ch.id, i + 1)]?.stars ?? 0
            );
            return sum + stars.reduce<number>((a, b) => a + b, 0);
          }, 0);
          const maxRegionStars = chaptersInRegion.length * ROUNDS_PER_CHAPTER * 3;
          const isFullyCompleted = maxRegionStars > 0 && totalRegionStars === maxRegionStars;

          return (
            <section
              key={region}
              className={`relative overflow-hidden rounded-3xl border ${theme.borderClass} ${theme.cardBg} ${theme.rimClass} p-6 sm:p-8 transition-all duration-300 hover:-translate-y-1`}
            >
              {/* Soft Fog & Padlock overlay on locked islands */}
              {regionLocked && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-3xl bg-black/70 backdrop-blur-sm p-6 text-center">
                  <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-zinc-900/90 text-3xl shadow-2xl">
                    🔒
                  </div>
                  <h3 className="text-xl font-bold text-white">Uzamčený ostrov: {theme.name}</h3>
                  <p className="mt-1.5 max-w-md text-sm text-zinc-300">
                    Tento plovoucí ostrov je zatím zahalen mlhou. Dokonči předchozí kapitoly, abys odemkl cestu dál!
                  </p>
                </div>
              )}

              {/* Floating Island Header Banner */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div className="flex items-center gap-3.5">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/40 text-2xl shadow-inner">
                    {theme.icon}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${theme.headerAccent}`}>
                        {theme.badge}
                      </span>
                      {isFullyCompleted && (
                        <span className="rounded-full border border-yellow-400/40 bg-yellow-500/20 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-yellow-300 shadow-[0_0_10px_rgba(234,179,8,0.3)]">
                          ✨ 100% SPLNĚNO
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-white">{theme.name}</h2>
                    <p className="text-xs text-zinc-300">{theme.subtitle}</p>
                  </div>
                </div>

                <div className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-bold shadow-md ${theme.starBadgeBg}`}>
                  <span>⭐</span>
                  <span>
                    {totalRegionStars} / {maxRegionStars} ★
                  </span>
                </div>
              </div>

              {/* Stepping stone paths connecting chapter nodes */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {chaptersInRegion.map((ch) => {
                  const locked = ch.id > unlocked;
                  const stars = Array.from(
                    { length: ROUNDS_PER_CHAPTER },
                    (_, i) => progress?.levels[levelId(ch.id, i + 1)]?.stars ?? 0
                  );
                  const total = stars.reduce<number>((a, b) => a + b, 0);

                  return (
                    <div
                      key={ch.id}
                      className={`relative flex flex-col justify-between rounded-2xl border p-4 sm:p-5 transition-all ${
                        locked
                          ? "border-white/5 bg-zinc-950/40 opacity-60"
                          : "border-white/10 bg-zinc-900/80 shadow-lg backdrop-blur-sm"
                      }`}
                    >
                      {/* Chapter info */}
                      <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                              Kapitola {ch.id}
                            </span>
                            {ch.gate && (
                              <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
                                Brána
                              </span>
                            )}
                            {!ch.gate && ch.newKeys.length > 0 && (
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-400">
                                +{ch.newKeys.join(" ")}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 font-bold text-white text-base leading-snug">{ch.name}</div>
                        </div>
                        <div className="text-xs font-bold text-yellow-400 whitespace-nowrap">
                          {total}/{ROUNDS_PER_CHAPTER * 3} ★
                        </div>
                      </div>

                      {/* Circular stepping stone rounds with connecting path trail */}
                      <div className="relative mt-4 flex items-center justify-between px-1">
                        {/* Winding trail connector line behind stepping stones */}
                        <div
                          className="pointer-events-none absolute left-4 right-4 top-1/2 -z-0 h-0.5 -translate-y-1/2 border-t-2 border-dashed border-white/15"
                          aria-hidden="true"
                        />

                        {stars.map((s, i) => {
                          const round = i + 1;
                          const isBoss = round === ROUNDS_PER_CHAPTER;
                          const roundLocked = locked || (round > 1 && stars[i - 1] === 0);
                          const isCurrent =
                            !roundLocked && next.chapter === ch.id && next.round === round;

                          if (roundLocked) {
                            return (
                              <div
                                key={round}
                                className={`relative z-10 flex flex-col items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-600 shadow-inner ${
                                  isBoss ? "h-11 w-11 text-xs" : "h-9 w-9 text-[11px]"
                                }`}
                                title={isBoss ? "Boss (zamčeno)" : `Kolo ${round} (zamčeno)`}
                                aria-label={isBoss ? `Kapitola ${ch.id}, Boss kolo (zamčeno)` : `Kapitola ${ch.id}, Kolo ${round} (zamčeno)`}
                              >
                                <span>{isBoss ? "💀" : "🔒"}</span>
                              </div>
                            );
                          }

                          return (
                            <Link
                              key={round}
                              href={`/hra?c=${ch.id}&r=${round}`}
                              aria-label={
                                isBoss
                                  ? `Kapitola ${ch.id}, Boss kolo, ${s} hvězdiček`
                                  : `Kapitola ${ch.id}, Kolo ${round}, ${s} hvězdiček`
                              }
                              className={`relative z-10 flex flex-col items-center justify-center rounded-full border-2 transition-all duration-200 hover:scale-110 ${
                                isBoss
                                  ? s > 0
                                    ? "h-12 w-12 border-amber-300 bg-gradient-to-br from-amber-500 via-yellow-500 to-amber-600 text-zinc-950 font-black shadow-[0_0_14px_rgba(245,158,11,0.7)]"
                                    : "h-12 w-12 border-amber-400 bg-gradient-to-br from-amber-700 via-amber-800 to-amber-950 text-amber-200 font-black shadow-lg"
                                  : s > 0
                                  ? "h-9 w-9 border-emerald-400 bg-emerald-700 text-white font-bold shadow-md hover:bg-emerald-600"
                                  : "h-9 w-9 border-zinc-600 bg-zinc-800 text-zinc-200 font-semibold hover:border-emerald-400 hover:bg-emerald-700"
                              } ${
                                isCurrent
                                  ? "ring-4 ring-emerald-400 ring-offset-2 ring-offset-zinc-950 scale-105 shadow-[0_0_12px_rgba(52,211,153,0.7)]"
                                  : ""
                              }`}
                              title={
                                isBoss
                                  ? `Boss kolo (hvězdy: ${s}/3)`
                                  : `Kolo ${round} (hvězdy: ${s}/3)`
                              }
                            >
                              <span className={isBoss ? "text-sm leading-none" : "text-xs font-bold leading-none"}>
                                {isBoss ? "👑" : round}
                              </span>
                              <span className="flex text-[7px] leading-none text-yellow-300 mt-0.5">
                                {s > 0 ? "★".repeat(s) : "···"}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
