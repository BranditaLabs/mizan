# ADR-0010: Firebase Authentication for users

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Need email and phone OTP sign-in quickly, plus push notifications; team already uses Firebase.

## Decision

Firebase Auth for identity (email, phone OTP, 2FA for owners/admins). The API verifies Firebase ID tokens and keeps authorization (tenants, roles) in Postgres. FCM for push.

## Consequences

Fast to build; phone OTP billed per SMS. Identity provider lock-in limited because roles and tenants live in our DB.
