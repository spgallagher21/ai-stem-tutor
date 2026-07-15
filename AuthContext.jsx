import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { deleteField, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, firebaseReady } from "./firebase";

const AuthContext = createContext(null);

function getGuestUid() {
  const key = "stem-guest-uid";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = `guest-${crypto.randomUUID()}`;
  localStorage.setItem(key, next);
  return next;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [uid, setUid] = useState(() => (firebaseReady ? null : getGuestUid()));
  const [authLoading, setAuthLoading] = useState(firebaseReady);

  useEffect(() => {
    if (!firebaseReady || !auth) return undefined;
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          await signInAnonymously(auth);
          return;
        }
        setUser(currentUser);
        setUid(currentUser.uid);
        if (db) {
          await setDoc(
            doc(db, "users", currentUser.uid),
            {
              profile: {
                email: currentUser.email || null,
                createdAt: serverTimestamp(),
                lastActive: serverTimestamp(),
              },
            },
            { merge: true }
          );
        }
      } finally {
        setAuthLoading(false);
      }
    });
    return unsub;
  }, []);

  const signInWithEmail = async (email, password) => {
    if (!auth) throw new Error("Firebase is not configured yet.");
    const credential = EmailAuthProvider.credential(email, password);
    if (auth.currentUser?.isAnonymous) {
      return linkWithCredential(auth.currentUser, credential);
    }
    return signInWithEmailAndPassword(auth, email, password);
  };

  const value = useMemo(
    () => ({
      user,
      uid,
      authLoading,
      firebaseReady,
      isAnonymous: firebaseReady ? Boolean(user?.isAnonymous) : true,
      signInWithEmail,
    }),
    [user, uid, authLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider.");
  return ctx;
}

export async function getSettings(uid) {
  if (!firebaseReady || !db || !uid) {
    const saved = localStorage.getItem("stem-settings");
    return saved ? JSON.parse(saved) : null;
  }
  const snap = await getDoc(doc(db, "users", uid, "settings", "app"));
  return snap.exists() ? snap.data() : null;
}

export async function saveSettings(uid, settings) {
  const { geminiApiKey: _secret, ...safeSettings } = settings;
  const payload = { ...safeSettings, updatedAt: firebaseReady ? serverTimestamp() : Date.now() };
  if (!firebaseReady || !db || !uid) {
    localStorage.setItem("stem-settings", JSON.stringify(payload));
    return;
  }
  await setDoc(doc(db, "users", uid, "settings", "app"), { ...payload, geminiApiKey: deleteField() }, { merge: true });
}
