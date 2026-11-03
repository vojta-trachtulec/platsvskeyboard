"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import type { Role } from "@/lib/firestore/types";

export function RequireAuth({ children, roles }: { children: React.ReactNode; roles?: Role[] }) {
  const { role } = useAuth();

  if (roles && !roles.includes(role)) {
    return <p className="py-20 text-center text-zinc-400">Tahle stránka je jen pro učitele.</p>;
  }

  return <>{children}</>;
}
