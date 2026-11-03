import { collection, doc, getDoc, serverTimestamp, setDoc, writeBatch, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { classId as computeClassId, schoolYearKey } from "@/lib/schoolYear";
import { suspicionReason } from "@/lib/scoring";
import { CHAPTERS, ROUNDS_PER_CHAPTER, completionPercent, levelId } from "@/game/content/curriculum";
import type { RunResult } from "@/game/types";
import type { ProgressDoc, StatsDoc, UserDoc } from "./types";

export async function getProgress(uid: string): Promise<ProgressDoc | null> {
  if (uid === "guest-presenter") {
    // V prezentačním režimu hosta: odemčené všechny kapitoly a čistý profil
    return {
      levels: {},
      completedRounds: 0,
      courseCompletion: 0,
      unlockedChapter: CHAPTERS.length, // všechny kapitoly odemčené k prezentaci
      bestCpm: 0,
      bestNetCpm: 0,
      totalRuns: 0,
      totalMinutes: 0,
      totalScore: 0,
      keyStats: {},
      updatedAt: new Date().toISOString() as unknown as Timestamp,
    };
  }
  try {
    const snap = await getDoc(doc(db, "progress", uid));
    return snap.exists() ? (snap.data() as ProgressDoc) : null;
  } catch {
    return null;
  }
}

export async function getStats(uid: string, year = schoolYearKey()): Promise<StatsDoc | null> {
  const snap = await getDoc(doc(db, "stats", `${uid}_${year}`));
  return snap.exists() ? (snap.data() as StatsDoc) : null;
}

function emptyProgress(): Omit<ProgressDoc, "updatedAt"> {
  return {
    levels: {},
    completedRounds: 0,
    courseCompletion: 0,
    unlockedChapter: 1,
    bestCpm: 0,
    bestNetCpm: 0,
    totalRuns: 0,
    totalMinutes: 0,
    totalScore: 0,
    keyStats: {},
  };
}

/** Kapitola je odemčená, když všechna kola předchozí kapitoly mají aspoň 1 hvězdičku. */
function computeUnlockedChapter(levels: ProgressDoc["levels"]): number {
  let unlocked = 1;
  for (const ch of CHAPTERS) {
    const done = Array.from({ length: ROUNDS_PER_CHAPTER }, (_, i) => levels[levelId(ch.id, i + 1)]?.stars ?? 0).every((s) => s > 0);
    if (done) unlocked = Math.min(CHAPTERS.length, ch.id + 1);
    else break;
  }
  return unlocked;
}

/**
 * Uloží běh + přepočítá progress a stats v jednom batchi.
 * Pravidla Firestore hlídají tvar a meze; pravdu ověřuje až audit skript.
 */
export async function saveRun(uid: string, profile: UserDoc, result: RunResult): Promise<{ progress: ProgressDoc; suspicious: string | null }> {
  if (uid === "guest-presenter") {
    const dummyProgress: ProgressDoc = {
      levels: { [result.levelId]: { stars: result.stars, bestCpm: result.cpm, attempts: 1 } },
      completedRounds: 1,
      courseCompletion: 5,
      unlockedChapter: CHAPTERS.length,
      bestCpm: result.cpm,
      bestNetCpm: result.netCpm,
      totalRuns: 1,
      totalMinutes: Math.round((result.durationMs / 60000) * 100) / 100,
      totalScore: result.score,
      keyStats: result.keyStats,
      updatedAt: new Date().toISOString() as unknown as Timestamp,
    };
    return { progress: dummyProgress, suspicious: null };
  }
  const year = schoolYearKey();
  const cls = computeClassId(profile.gradYear, profile.track, year);
  const prev = (await getProgress(uid)) ?? (emptyProgress() as ProgressDoc);

  const intervals: number[] = [];
  for (let i = 1; i < result.keystrokes.length; i++) intervals.push(result.keystrokes[i][0] - result.keystrokes[i - 1][0]);
  const suspicious = suspicionReason({ correct: result.correct, errors: result.errors, durationMs: result.durationMs, cpm: result.cpm, intervalsMs: intervals });

  const levels = { ...prev.levels };
  const before = levels[result.levelId];
  levels[result.levelId] = {
    stars: Math.max(before?.stars ?? 0, result.stars) as 0 | 1 | 2 | 3,
    bestCpm: Math.max(before?.bestCpm ?? 0, result.cpm),
    attempts: (before?.attempts ?? 0) + 1,
  };
  const completedRounds = Object.values(levels).filter((l) => l.stars > 0).length;

  const keyStats = { ...prev.keyStats };
  for (const [k, s] of Object.entries(result.keyStats)) {
    keyStats[k] = { hits: s.hits, misses: s.misses };
  }

  const progress: Omit<ProgressDoc, "updatedAt"> = {
    levels,
    completedRounds,
    courseCompletion: completionPercent(completedRounds),
    unlockedChapter: computeUnlockedChapter(levels),
    bestCpm: Math.max(prev.bestCpm, suspicious ? 0 : result.cpm),
    bestNetCpm: Math.max(prev.bestNetCpm, suspicious ? 0 : result.netCpm),
    totalRuns: prev.totalRuns + 1,
    totalMinutes: Math.round((prev.totalMinutes + result.durationMs / 60000) * 100) / 100,
    totalScore: prev.totalScore + (suspicious ? 0 : result.score),
    keyStats,
  };

  const statsRef = doc(db, "stats", `${uid}_${year}`);
  const prevStats = (await getDoc(statsRef)).data() as StatsDoc | undefined;
  const runsCount = (prevStats?.runs ?? 0) + 1;
  const avgAccuracy = Math.round((((prevStats?.avgAccuracy ?? result.accuracy) * (runsCount - 1) + result.accuracy) / runsCount) * 10) / 10;

  const stats: Omit<StatsDoc, "lastRunAt"> = {
    uid,
    schoolYear: year,
    classId: cls,
    displayName: profile.displayName,
    courseCompletion: progress.courseCompletion,
    bestCpm: progress.bestCpm,
    bestNetCpm: progress.bestNetCpm,
    totalScore: progress.totalScore,
    totalMinutes: progress.totalMinutes,
    runs: runsCount,
    avgAccuracy,
  };

  const batch = writeBatch(db);
  const runRef = doc(collection(db, "runs"));
  batch.set(runRef, {
    uid,
    schoolYear: year,
    classId: cls,
    levelId: result.levelId,
    startedAt: serverTimestamp(),
    durationMs: result.durationMs,
    cpm: result.cpm,
    netCpm: result.netCpm,
    accuracy: result.accuracy,
    score: result.score,
    stars: result.stars,
    won: result.won,
    livesLost: result.livesLost,
    correct: result.correct,
    errors: result.errors,
    keystrokes: result.keystrokes.slice(0, 4000).flat(),
    suspicious,
  });
  batch.set(doc(db, "progress", uid), { ...progress, updatedAt: serverTimestamp() });
  batch.set(statsRef, { ...stats, lastRunAt: serverTimestamp() });
  await batch.commit();

  return { progress: { ...progress, updatedAt: serverTimestamp() as unknown as Timestamp }, suspicious };
}

/**
 * Uloží tréninkový Zen běh:
 * - Aktualizuje POUZE osobní `progress.keyStats` (a čas/počet běhů dle pravidel),
 * - NIKDY nezapisuje do soutěžních `stats/{uid}_{year}` ani žebříčků,
 * - Nezapisuje soutěžní body, hvězdičky ani neovlivňuje bestCpm / postup kurzem.
 */
export async function saveZenPractice(
  uid: string,
  result: RunResult,
): Promise<{ progress: ProgressDoc; suspicious: null }> {
  if (uid === "guest-presenter") {
    const dummyProgress: ProgressDoc = {
      levels: {},
      completedRounds: 0,
      courseCompletion: 0,
      unlockedChapter: CHAPTERS.length,
      bestCpm: 0,
      bestNetCpm: 0,
      totalRuns: 1,
      totalMinutes: 0,
      totalScore: 0,
      keyStats: result.keyStats,
      updatedAt: new Date().toISOString() as unknown as Timestamp,
    };
    return { progress: dummyProgress, suspicious: null };
  }
  const prev = (await getProgress(uid)) ?? (emptyProgress() as ProgressDoc);

  const keyStats = { ...prev.keyStats };
  for (const [k, s] of Object.entries(result.keyStats)) {
    keyStats[k] = { hits: s.hits, misses: s.misses };
  }

  const progress: Omit<ProgressDoc, "updatedAt"> = {
    levels: prev.levels,
    completedRounds: prev.completedRounds,
    courseCompletion: prev.courseCompletion,
    unlockedChapter: prev.unlockedChapter,
    bestCpm: prev.bestCpm,
    bestNetCpm: prev.bestNetCpm,
    totalRuns: prev.totalRuns + 1,
    // zen se do minut nepočítá — totalMinutes jde do soutěžního žebříčku „Nejpilnější“
    totalMinutes: prev.totalMinutes,
    totalScore: prev.totalScore,
    keyStats,
  };

  await setDoc(doc(db, "progress", uid), { ...progress, updatedAt: serverTimestamp() });

  return { progress: { ...progress, updatedAt: serverTimestamp() as unknown as Timestamp }, suspicious: null };
}
