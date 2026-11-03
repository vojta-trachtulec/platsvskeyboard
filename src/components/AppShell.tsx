"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";

const NAV = [
  { href: "/", label: "Mapa" },
  { href: "/zebricek", label: "Žebříček" },
  { href: "/profil", label: "Profil" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { access, role } = useAuth();
  const path = usePathname();
  const isTeacher = role === "teacher" || role === "admin";
  const inGame = path.startsWith("/hra");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10 bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden>🧟</span> Plants vs. Keyboard
          </Link>
          {access === "ok" && !inGame && (
            <nav className="flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 hover:bg-white/10 ${path === n.href ? "bg-white/10 font-semibold" : ""}`}
                >
                  {n.label}
                </Link>
              ))}
              {isTeacher && (
                <Link href="/ucitel" className={`rounded-md px-3 py-1.5 hover:bg-white/10 ${path === "/ucitel" ? "bg-white/10 font-semibold" : ""}`}>
                  Učitel
                </Link>
              )}
            </nav>
          )}
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-300 sm:inline">Režim hosta</span>
            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
              Prezentace
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-white/10 py-4 text-center text-xs text-zinc-500">
        <img src="/game/zombie-zelva@320.png" alt="" aria-hidden className="mx-auto mb-2 h-12 w-auto opacity-80" />
        Gymnázium Havlíčkův Brod · studenti IT semináře a učitel Adam Ferencz · školní rok{" "}
        {new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1}/
        {String((new Date().getMonth() >= 8 ? new Date().getFullYear() + 1 : new Date().getFullYear()) % 100).padStart(2, "0")}
      </footer>
    </div>
  );
}
