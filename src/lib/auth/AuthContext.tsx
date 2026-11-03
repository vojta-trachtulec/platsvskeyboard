"use client";

import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase/client";
import { ensureUserDoc, getAllowedUser } from "@/lib/firestore/user";
import type { Role, UserDoc } from "@/lib/firestore/types";
import { isSchoolEmail } from "@/lib/schoolYear";

export type AccessState =
  | "loading"
  | "anonymous"
  | "unverified" // heslo, e-mail ještě neověřen
  | "forbidden" // přihlášen, ale není ze školy ani na whitelistu
  | "ok";

interface AuthValue {
  user: User | null;
  profile: UserDoc | null;
  role: Role;
  access: AccessState;
  refreshProfile: () => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string) => Promise<void>;
  registerEmail: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Pro účely prezentace / hosta: automatický přístup bez nutnosti přihlašování
  const [user, setUser] = useState<User | null>({
    uid: "guest-presenter",
    email: "prezentace@skola.cz",
    displayName: "Prezentace (Host)",
    emailVerified: true,
  } as unknown as User);
  const [profile, setProfile] = useState<UserDoc | null>({
    email: "prezentace@skola.cz",
    displayName: "Prezentace (Host)",
    gradYear: 2027,
    track: "C",
    layout: "qwertz",
    createdAt: new Date().toISOString() as unknown as import("firebase/firestore").Timestamp,
    lastActiveAt: new Date().toISOString() as unknown as import("firebase/firestore").Timestamp,
  });
  const [role, setRole] = useState<Role>("student");
  const [access, setAccess] = useState<AccessState>("ok");

  const evaluate = useCallback(async (u: User | null) => {
    // Pokud je uživatel skutečně přihlášen přes Firebase, načíst jeho data, jinak nechat režim hosta
    if (!u) {
      setUser({
        uid: "guest-presenter",
        email: "prezentace@skola.cz",
        displayName: "Prezentace (Host)",
        emailVerified: true,
      } as unknown as User);
      setProfile({
        email: "prezentace@skola.cz",
        displayName: "Prezentace (Host)",
        gradYear: 2027,
        track: "C",
        layout: "qwertz",
        createdAt: new Date().toISOString() as unknown as import("firebase/firestore").Timestamp,
        lastActiveAt: new Date().toISOString() as unknown as import("firebase/firestore").Timestamp,
      });
      setRole("student");
      setAccess("ok");
      return;
    }
    setUser(u);
    try {
      const allowed = await getAllowedUser(u.email);
      setRole(allowed?.role ?? "student");
      setProfile(await ensureUserDoc(u));
    } catch {
      // Při selhání Firebase sítě zachovat profil hosta
    }
    setAccess("ok");
  }, []);

  useEffect(() => onAuthStateChanged(auth, (u) => void evaluate(u)), [evaluate]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      role,
      access,
      refreshProfile: async () => {
        if (user) setProfile(await ensureUserDoc(user));
      },
      signInGoogle: async () => {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await signInWithPopup(auth, provider);
      },
      signInEmail: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      registerEmail: async (email, password) => {
        const e = email.trim().toLowerCase();
        if (!isSchoolEmail(e) && !(await getAllowedUser(e))) {
          throw new Error(`Registrovat se dá jen školním e-mailem @${process.env.NEXT_PUBLIC_SCHOOL_DOMAIN ?? "ghb.cz"}.`);
        }
        const cred = await createUserWithEmailAndPassword(auth, e, password);
        await sendEmailVerification(cred.user);
      },
      resetPassword: async (email) => {
        await sendPasswordResetEmail(auth, email.trim());
      },
      resendVerification: async () => {
        if (auth.currentUser) await sendEmailVerification(auth.currentUser);
      },
      signOut: async () => {
        await fbSignOut(auth);
      },
    }),
    [user, profile, role, access],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth mimo AuthProvider");
  return v;
}
