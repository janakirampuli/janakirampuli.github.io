---
layout: post
title: "Building an Auth Service"
date: 2026-07-25
tags: ["auth", "backend", "systems"]
published: true
---

A write-up of how I built our auth service: the requirements it had to satisfy, things I learnt, and how [better-auth](https://better-auth.com) made it easy to implement.

## Contents

<div class="ia-toc" markdown="1">

- [Two kinds of auth](#two-kinds-of-auth)
- [Requirements](#requirements)
- [Authenticating a request](#authenticating-a-request)
- [Sessions, JWTs, cookies, and revocation](#sessions-jwts-cookies-and-revocation)
- [better-auth](#better-auth)
- [better-auth plugins](#better-auth-plugins)
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
- **Authenticate and authorize users.** Two questions on every request: "are you logged in?" and "can you do this?"
- **Multi-tenancy: users belong to organizations.** A user can be a member of more than one org, and the session carries an active organization, which is the org the user is currently working in. All the permission checks use that org as context.
- **Role-based access control (RBAC) within an org.** An org has roles (owner, admin, member, …), and what you can do depends on your role in the active org. The same person can be an owner in one org and a viewer in another.
- **API keys.** Programmatic access that isn't tied to a browser session, for users scripting against the API and for integrations.
- **Services can call auth.** A backend service can obtain a token and verify a token, with no human involved.
- **Enterprise login methods.** OAuth (social login), SSO (enterprise identity providers), and SCIM (automated user provisioning/deprovisioning).

---

## Authenticating a request

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

AuthN does not happen only once at login. You type your password or log in with Google once. But every request after that still has to be checked. The check is just cheaper: the server reads the token, or looks up the session id if it's session based. AuthZ runs on every protected action ("can this user delete this resource in this org?").

---

## Sessions, JWTs, cookies, and revocation

Sessions (stateful) - the server generates an opaque session id, stores the session in a database, and hands the id to the client. Every request looks the session up.

- Revoking is trivial. Delete the row and the session is dead immediately.
- The cost is a lookup (usually a DB or cache hit) on every request, and every service that verifies has to reach that store.

JWTs (stateless) - a signed token that carries the claims (user id, active org, roles, expiry). Anyone with the public key can verify it without calling back to auth.

- Good for scale and for machine-to-machine: no shared session store, verification is a local signature check.
- Revocation is not immediate. A JWT stays valid until it expires. Nobody has to call back to auth to check it, which is the whole point, and it is also why you cannot cancel one early. So you keep the lifetime short, usually 10-15 minutes, and mint a new one when it runs out.

A cookie is just a way to carry the token, not a different approach. The web app keeps it in an httpOnly, Secure, SameSite cookie so JavaScript can't read it, which rules out stealing the token via XSS but leaves you to handle CSRF. Mobile and service-to-service calls send the same token in an `Authorization: Bearer` header.

So I split it this way:

- **Sessions for humans.** better-auth stores the session in our database, so logging out, "sign out everywhere," and a password change all take effect right away. The expiry slides forward on its own: a session lasts 7 days, and once it is more than a day old, using it pushes the expiry out again. There is no separate refresh token to keep track of, the session is the refresh.
- **JWTs for machines and cross-service calls.** When a request crosses a service boundary it carries a short-lived JWT that the receiving service verifies locally. We mint one from the session with `authClient.token()`, hold on to it, and attach it to outgoing calls. It lives 15 minutes, so we mint a fresh one every few minutes, and again whenever a call comes back with a 401.

---

## better-auth

I used [better-auth](https://better-auth.com) for this. It's a TypeScript-native, fully self-hosted auth library: it owns tables in our database, runs inside our backend, and all the user data stays with us. The team was [acquired by Vercel](https://vercel.com/blog/vercel-acquires-better-auth) recently :)

The core gives you email/password and sessions; everything else is a plugin, and each one brings its own database schema, server routes, and a matching client helper. The plugins I used map almost one-to-one onto the requirements above:

- `organization()` - orgs, members, invitations, roles, and the active organization concept.
- `apiKey()` - issuing, hashing, and verifying API keys.
- `jwt()` - issuing JWTs and exposing a JWKS endpoint so other services can verify tokens locally.
- `sso()` - enterprise SSO via OIDC/SAML.
- `scim()` - enterprise SCIM for directory sync.
- `admin()` - impersonation, user management, and access-control primitives.

---

## better-auth plugins

The core setup is small. You build the auth instance out of plugins:

```ts
import { betterAuth } from "better-auth";
import { organization, apiKey, jwt, sso, scim, admin } from "better-auth/plugins";

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
    scim(),
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

We needed role-based access control: you don't give permissions to users, you give them to roles, then put users in roles. To change what an admin can do, you edit one role. You don't have to update every user row.

There are three layers to it.

1. **Permissions.** The smallest unit, each one a resource plus an action: `project:delete`, `member:invite`, ...
2. **Roles.** Named groups of permissions: `member`, `admin`, `owner`.
3. **Membership.** What ties a user to a role.

A user does not get a role globally, they get a role in each organization.

```ts
// a user can belong to many orgs; switching sets the active one on the session
await authClient.organization.setActive({ organizationId });

// membership carries a role scoped to that org
await authClient.organization.inviteMember({
  email: "janaki@gmail.com",
  role: "admin",
});
```

Defining the permissions and the roles built out of them:

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

Then hand those roles back to the plugin, otherwise it uses its own built-in ones:

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

Because roles are built out of small permissions instead of hard-coded strings, adding a new capability is a one-line change in one place.

---

## Login methods: OAuth, SSO, SCIM

OAuth (social login) - "Sign in with Google/GitHub." The user is sent to the provider, approves, and comes back with an authorization code that we trade for their profile. PKCE stops that code from being stolen on public clients like mobile. better-auth handles the flow.

SSO (enterprise identity) - when you sell to companies, they want their employees logging in through their own identity provider (Okta, Entra, Google Workspace) over OIDC or SAML. The customer's IT team controls access, and login is based on the email domain.

```ts
// register a customer's identity provider, keyed to their domain
await auth.api.registerSSOProvider({
  body: {
    issuer: "https://foo.okta.com",
    domain: "foo.com",
    providerId: "foo-okta",
    // ...OIDC/SAML metadata
  },
});
```

SCIM (provisioning) - SSO gets people in; SCIM keeps the user list in sync. When a big company onboards, they don't want to invite users one by one, and when someone leaves, their access has to be removed everywhere automatically. SCIM is a standard REST protocol that their IdP calls to create, update, and deactivate users in our system. It's the "someone got fired on Friday and must be locked out by Friday" feature. A SCIM deprovision event marks the member inactive and revokes their sessions right away.

---

## Architecture: how everything talks to auth

1. **User → auth.** A person logs in and gets a session (cookie on web, bearer token on mobile).
2. **Service → auth.** A backend service logs in as itself (client-credentials style) to get a short-lived token, for calls where there is no user, like a cron job or an internal job runner.
3. **Service → service.** One service calls another and passes the token along. The receiving service has to verify it.

The naive version of #3 is a disaster: every service calls auth on every request to ask "is this token valid?". Now auth sits in front of 100% of traffic, so its latency is added to every request, and if auth goes down, everything goes down.

The fix is to issue tokens in one place but verify them everywhere, using JWKS:

- Auth is the only issuer. It holds the private signing key and creates every JWT.
- Auth publishes the matching public keys at a JWKS endpoint. Point the other services there, or proxy the well-known path to it.
- Every other service fetches those keys once, caches them, and verifies tokens locally. It is a signature check in memory, with no network call to auth on each request.

Verifying locally in another service looks like this:

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

API keys are the "no browser, no user session" path, for customers writing scripts/automations against the API and for integrations:

- **Hashed at rest.** The full key is shown to the user once, at creation. We store only a hash, so a database leak does not leak usable keys.
- **Scoped and attributable.** A key belongs to a user and an org, and carries its own set of permissions, so it can be narrower than the person who created it.

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

An API key has to be checked against the database. A JWT carries its own claims, so it only needs a signature check. The key proves who you are at the edge, and from there we map it back to the same user/org/permission model everything else uses:

1. `verifyApiKey` gives us the key record: the user it belongs to, the org it was created in, and the permissions stored on it.
2. We load that user's membership in the org, which gives us their role and everything that role allows.
3. The permissions we actually apply are the overlap of the two, so a key can never do more than the person who created it. If they get demoted or removed from the org, their keys shrink with them.

---

## References

1. [better-auth documentation](https://better-auth.com)
2. [BoxyHQ](https://boxyhq.com)
3. [Ory](https://www.ory.sh)
4. [Okta](https://developer.okta.com)
5. [WorkOS](https://workos.com)
