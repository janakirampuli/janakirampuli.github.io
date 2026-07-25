---
layout: post
title: "Building an Auth Service"
date: 2026-07-25
tags: ["auth", "backend", "systems"]
published: true
---

A write-up of how I built our auth service: the requirements it had to satisfy, the concepts I had to understand, and how [better-auth](https://better-auth.com) made most of it easy to implement.

## Contents

<div class="ia-toc" markdown="1">

- [Two kinds of auth](#two-kinds-of-auth)
- [Requirements](#requirements)
- [The basics: authenticating a request](#the-basics-authenticating-a-request)
- [Sessions, JWTs, cookies, and revocation](#sessions-jwts-cookies-and-revocation)
- [better-auth](#better-auth)
- [Building it](#building-it)
- [Multi-tenancy and RBAC: orgs, roles, permissions](#multi-tenancy-and-rbac-orgs-roles-permissions)
- [Login methods: OAuth, SSO, SCIM](#login-methods-oauth-sso-scim)
- [Architecture: how everything talks to auth](#architecture-how-everything-talks-to-auth)
- [API keys](#api-keys)
- [References](#references)

</div>

---

## Two kinds of auth

- **Human auth** - a person opens the web app or mobile app, proves who they are (password, Google login, their company's SSO), and gets a session.
- **Machine auth** - a backend service needs to call another service, or call auth itself, with no human in the loop. It still needs an identity and still needs to be authorized.

---

## Requirements

- **Users can log in via web and mobile.** One identity, multiple clients.
- **Authenticate and authorize users.** Both axes: "are you logged in" and "can you do this."
- **Multi-tenancy: users belong to organizations.** A user can be a member of more than one org, and the session carries an active organization, meaning the org the user is currently working in. All the permission checks use that org.
- **Role-based access control (RBAC) within an org.** An org has roles (owner, admin, member, …), and what you can do depends on your role in the active org. The same person can be an owner in one org and a read-only member in another.
- **API keys.** Programmatic access that isn't tied to a browser session, for users scripting against the API and for integrations.
- **Services can call auth.** A backend service can obtain a token and verify a token, with no human involved.
- **Enterprise login methods.** OAuth (social login), SSO (enterprise identity providers), and SCIM (automated user provisioning/deprovisioning).

---

## The basics: authenticating a request

An auth service comes down to one question on every request: who is making this call, and are they allowed to do it?

An HTTP request is anonymous by default, so the client has to attach proof of identity. That proof shows up in one of two ways:

- **A bearer token** - the client sends it in a header on every request:

  ```
  Authorization: Bearer <token>
  ```

  The token is the credential. Anyone who holds it ("bears" it) is treated as that user. This is what mobile apps and backend services use.

- **A session cookie** - after login the server sets a cookie, and the browser attaches it automatically to every following request. The cookie carries (or points to) the credential. This is what the web app uses.

Either way, the server does the same two things on each request.

- **Authentication (authN)** - who are you? Take the token or cookie off the request, check it's valid, and resolve it to a user (or a service).
- **Authorization (authZ)** - what are you allowed to do? Given that identity, check its roles and permissions in the active org before letting the action through.

AuthN does not happen only once at login. You type your password or log in with Google once. But every request after that still has to be checked. The check is just cheaper: the server reads the token or looks up the session id. AuthZ runs on every protected action ("can this user delete this resource in this org?"). That is where multi-tenancy and roles come in.

They also fail differently. If the token is bad or missing, you get a `401 Unauthorized`. If the token is fine but you don't have permission, you get a `403 Forbidden`. The names are confusing, because 401 actually means "not authenticated", but the codes are fixed by the RFC.

---

## Sessions, JWTs, cookies, and revocation

Sessions (stateful) - the server generates an opaque session id, stores the session in a database, and hands the id to the client. Every request looks the session up.

- Revoking is trivial. Delete the row and the session is dead immediately.
- The cost is a lookup (usually a DB or cache hit) on every request, and every service that verifies has to reach that store.

JWTs (stateless) - a signed token that carries the claims (user id, active org, roles, expiry). Anyone with the public key can verify it without calling back to auth.

- Good for scale and for machine-to-machine: no shared session store, verification is a local signature check.
- The catch is revocation. A JWT is valid until it expires. By design, nobody has to call back to auth to check it, and that is also why you cannot easily cancel one before it expires.

A cookie is just a way to carry the token, not a different approach. For the web app, the token lives in an httpOnly, Secure, SameSite cookie so JavaScript can't read it (this blocks XSS token theft), but then you have to deal with CSRF. For mobile and service-to-service, the token is sent in an `Authorization: Bearer` header instead.

So I split it this way:

- **Short-lived access tokens + long-lived refresh tokens.** Access tokens (JWTs) live ~15 minutes, so a stolen or old one is only useful for a short time. A refresh token (checked against the database) issues new access tokens, and it can be revoked.
- **Sessions for humans, JWTs for machines and cross-service calls.** The browser/mobile session is server-tracked (revoke on logout, "sign out everywhere," password change). When a request crosses a service boundary, it carries a short-lived JWT that the receiving service verifies locally.

---

## better-auth

I built this on [better-auth](https://better-auth.com). It's a TypeScript-native, fully self-hosted auth library: it owns tables in your database, runs in your backend, and you keep every piece of user data. Nothing redirects out to a third party, and there's no per-MAU pricing.

The core gives you email/password and sessions; everything else is a plugin, and each one brings its own database schema, server routes, and a matching client helper. The plugins I used map almost one-to-one onto the requirements above:

- `organization()` - orgs, members, invitations, roles, and the active organization concept.
- `apiKey()` - issuing, hashing, and verifying API keys.
- `jwt()` - issuing JWTs and exposing a JWKS endpoint so other services can verify tokens locally.
- `sso()` - enterprise SSO via OIDC/SAML.
- `admin()` - impersonation, user management, and access-control primitives.

---

## Building it

The core setup is small. You build the auth instance out of plugins:

```ts
import { betterAuth } from "better-auth";
import { organization, apiKey, jwt, sso, admin } from "better-auth/plugins";

export const auth = betterAuth({
  emailAndPassword: { enabled: true },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [
    organization(),
    apiKey(),
    jwt(),
    sso(),
    admin(),
  ],
});
```

On the client, each server plugin has a counterpart, so the methods it adds are fully typed:

```ts
import { createAuthClient } from "better-auth/client";
import {
  organizationClient,
  apiKeyClient,
  ssoClient,
} from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient(), apiKeyClient(), ssoClient()],
});

// signing in is just:
await authClient.signIn.email({ email, password });
await authClient.signIn.social({ provider: "google" });
```

---

## Multi-tenancy and RBAC: orgs, roles, permissions

I used role-based access control: you don't give permissions to users, you give them to roles, then put users in roles. To change what an admin can do, you edit one role. You don't have to update every user row.

There are three layers to it.

1. **Permissions.** The smallest unit, each one a resource plus an action: `project:delete`, `member:invite`, ...
2. **Roles.** Named groups of permissions: `member`, `admin`, `owner`.
3. **Membership.** What ties a user to a role.

A user does not get a role globally, they get a role in each organization. The same person might be an `owner` of their own org and a `member` of a client's org.

```ts
// a user can belong to many orgs; switching sets the active one on the session
await authClient.organization.setActive({ organizationId });

// membership carries a role scoped to that org
await authClient.organization.inviteMember({
  email: "janaki@gmail.com",
  role: "admin",
});
```

Sample code

```ts
import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  adminAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const ac = createAccessControl({
  ...defaultStatements,
  project: ["create", "read", "update", "delete"],
});

const member = ac.newRole({ project: ["read"] });
const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update"],
});
const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete"],
});
```

You then have to pass those roles back to the plugin. If you don't, it quietly keeps using its own built-in roles:

```ts
organization({ ac, roles: { member, admin, owner } })
```

A permission check then looks like this, instead of `if (user.role === "admin")` spread all over the codebase:

```ts
const { success } = await auth.api.hasPermission({
  headers,
  body: { permissions: { project: ["delete"] } },
});
```

Because roles are built out of small permissions instead of hard-coded strings, adding a new capability is a one-line change in one place. No search-and-replace across services.

---

## Login methods: OAuth, SSO, SCIM

Three words that all sound like "log in with your company account", but they solve different problems.

OAuth (social login) - "Sign in with Google/GitHub." The user is sent to the provider, approves, and comes back with an authorization code that we trade for their profile. PKCE stops that code from being stolen on public clients like mobile. better-auth handles the flow.

SSO (enterprise identity) - when you sell to companies, they want their employees logging in through their own identity provider (Okta, Entra, Google Workspace) over OIDC or SAML. The customer's IT team controls access, and login is based on the email domain.

```ts
// register a customer's identity provider, keyed to their domain
await auth.api.registerSSOProvider({
  body: {
    issuer: "https://acme.okta.com",
    domain: "acme.com",
    providerId: "acme-okta",
    // ...OIDC/SAML metadata
  },
});
```

SCIM (provisioning) - SSO gets people in; SCIM keeps the user list in sync. When a big company onboards, they don't want to invite users one by one, and when someone leaves, their access has to be removed everywhere automatically. SCIM is a standard REST protocol that their IdP calls to create, update, and deactivate users in our system. It's the "someone got fired on Friday and must be locked out by Friday" feature. It fits straight into the org/member model: a SCIM deprovision event marks the member inactive and revokes their sessions right away. Access tokens that were already issued keep working until they expire, which is why those expiries are short.

OAuth for convenience, then SSO when customers want to control login centrally, then SCIM when they want the user list managed too.

---

## Architecture: how everything talks to auth

1. **User → auth.** A person logs in and gets a session (cookie on web, bearer token on mobile).
2. **Service → auth.** A backend service logs in as itself (client-credentials style) to get a short-lived token, for calls where there is no user, like a cron job or an internal job runner.
3. **Service → service.** One service calls another and passes the token along. The receiving service has to verify it.

The naive version of #3 is a disaster: every service calls auth on every request to ask "is this token valid?". Now auth sits in front of 100% of traffic, so its latency is added to every request, and if auth goes down, everything goes down.

The fix is to issue tokens in one place but verify them everywhere, using JWKS:

- Auth is the only issuer. It holds the private signing key and creates every JWT.
- Auth publishes the matching public keys at a JWKS endpoint. Point the other services there, or proxy the well-known path to it.
- Every other service fetches those keys once, caches them, and verifies tokens locally. It is just a signature check in memory, with no network call to auth on each request.

Verifying locally in another service looks roughly like this:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

// fetched once and cached; refreshed automatically when a new `kid` appears
const jwks = createRemoteJWKSet(
  new URL("https://auth.internal/api/auth/jwks"),
);

export async function verify(token: string) {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "https://auth.internal",
    audience: "internal-services",
  });
  return payload; // { sub, activeOrg, roles, exp, ... }
}
```

Key rotation keeps this safe over time. Each key has a `kid` (key id) in the JWT header. To rotate, auth starts signing with a new key but still publishes the old public key, so tokens that are already out there keep working. Once those old tokens have expired, the old key is removed. Each service picks the right key by `kid` on its own, so nobody has to switch keys at the same moment.

---

## API keys

API keys are the "no browser, no user session" path, for customers writing scripts against the API and for long-running integrations:

- **Hashed at rest.** The full key is shown to the user once, at creation. We store only a hash, so a database leak does not leak usable keys.
- **Scoped and attributable.** A key belongs to a user/org and has its own permissions, so it can be narrower than the person who created it. It shows up in audit logs.
- **Revocable and rotatable on its own.** Deleting one key does not affect anyone's sessions.

```ts
const { key } = await auth.api.createApiKey({
  body: {
    name: "foo",
    permissions: { project: ["read"] },
    expiresIn: 60 * 60 * 24 * 90, // 90 days
  },
});

// verify on an incoming request
const { valid, key: meta } = await auth.api.verifyApiKey({
  body: { key: incomingKey },
});
```

An API key has to be checked against the database. A JWT carries its own claims, so it only needs a signature check. The key proves who you are at the edge. Inside, we still map it to the same user/org/permission model, and for calls between services we issue a short-lived JWT. That way every service verifies the same way, no matter how the request first logged in.

---

## References:

1. [better-auth documentation](https://better-auth.com)
2. [BoxyHQ](https://boxyhq.com)
3. [Ory](https://www.ory.sh)
4. [Okta](https://developer.okta.com)
5. [WorkOS](https://workos.com)
