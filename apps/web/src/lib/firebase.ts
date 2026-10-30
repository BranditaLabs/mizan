"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, RecaptchaVerifier, type Auth } from "firebase/auth";

/**
 * Firebase Authentication in the browser (ADR: Firebase Auth; the API verifies the ID tokens).
 * Configured at build time with NEXT_PUBLIC_FIREBASE_*; NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL points
 * development and tests at the Auth emulator (the API must run with FIREBASE_AUTH_EMULATOR_HOST too).
 */
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};
const emulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL;

export const authConfigured = Boolean(config.apiKey && config.projectId);

let auth: Auth | undefined;

/** The Auth instance, created once; null when sign-in is not configured for this build. */
export function firebaseAuth(): Auth | null {
  if (!authConfigured) return null;
  if (auth) return auth;
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  if (emulator) {
    connectAuthEmulator(auth, emulator, { disableWarnings: true });
    // The emulator needs no reCAPTCHA: no request to Google from tests and local development.
    auth.settings.appVerificationDisabledForTesting = true;
  }
  return auth;
}

/** Firebase writes its SMS and emails in this language (\r\ or \en\). */
export function setAuthLanguage(language: string): void {
  const a = firebaseAuth();
  if (a) a.languageCode = language;
}

let verifier: RecaptchaVerifier | null = null;

/**
 * Invisible reCAPTCHA required by Firebase before it sends an SMS (sign-in, second factor,
 * enrolment). A fresh one per send, in a new child of the page's (empty, hidden) container:
 * a used verifier cannot be rendered twice.
 */
export function smsVerifier(a: Auth, containerId: string): RecaptchaVerifier {
  verifier?.clear();
  const slot = document.createElement("div");
  document.getElementById(containerId)?.replaceChildren(slot);
  verifier = new RecaptchaVerifier(a, slot, { size: "invisible" });
  return verifier;
}
