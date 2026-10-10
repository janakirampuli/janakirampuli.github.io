---
layout: post
title: "Building an Auth Service"
date: 2026-07-25
tags: ["auth", "backend", "systems"]
published: true
---

This post tells how I built our auth service. It gives the requirements, the things that I learned, and how [better-auth](https://better-auth.com) made the implementation easy.

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

- **Human auth** - A person opens the web app or the mobile app and proves their identity (password, Google login, or the SSO of their company). Then the person gets a session.
- **Machine auth** - A backend service must call a different service, or call auth itself, and no person is involved. The service must also have an identity and an authorization.

---

## Requirements

- **Users can log in from web and mobile.** One identity, more than one client.
- **Authenticate and authorize users.** Each request has two questions: "are you logged in?" and "can you do this?"
- **Multi-tenancy: users belong to organizations.** A user can be a member of more than one org. The session contains an active organization, which is the org in which the user works at that time. All the permission checks use that org as context.
- **Role-based access control (RBAC) in an org.** An org has roles (owner, admin, member, …). Your role in the active org controls what you can do. The same person can be an owner in one org and a viewer in a different org.
- **API keys.** Programmatic access that has no relation to a browser session. It is for users who write scripts for the API and for integrations.
- **Services can call auth.** A backend service can get a token and verify a token, and no person is involved.
- **Enterprise login methods.** OAuth (social login), SSO (enterprise identity providers), and SCIM (automated user provisioning/deprovisioning).

---

## Authenticating a request

An auth service answers one question on each request: who makes this call, and do they have permission to do it?

An HTTP request is anonymous by default, so the client must attach proof of identity. There are two types of proof:

- **A bearer token** - The client sends it in a header on each request:

  ```
  Authorization: Bearer <token>
  ```

  The token is the credential. The server treats each person who holds ("bears") the token as that user. Mobile apps and backend services use this type.

- **A session cookie** - After login, the server sets a cookie, and the browser automatically attaches it to each subsequent request. The cookie contains the credential or points to it. The web app uses this type.

For the two types, the server does the same two things on each request.

- **Authentication (authN)** - Who are you? Get the token or the cookie from the request, make sure that it is valid, and find the user (or the service) that it identifies.
- **Authorization (authZ)** - What can you do? For that identity, examine its roles and permissions in the active org before you permit the action.

AuthN does not occur only one time at login. You enter your password or log in with Google one time. But the server must also check each subsequent request. That check is cheaper: the server reads the token, or finds the session by its id if the auth uses sessions. AuthZ runs on each protected action ("can this user delete this resource in this org?").

---

## Sessions, JWTs, cookies, and revocation

Sessions (stateful) - The server makes an opaque session id, keeps the session in a database, and gives the id to the client. Each request causes a lookup of the session.

- Revocation is easy. Delete the row and the session stops immediately.
- The cost is a lookup (usually in a DB or a cache) on each request. Each service that verifies a session must have access to that store.

JWTs (stateless) - A JWT is a signed token that contains the claims (user id, active org, roles, expiry). Each service that has the public key can verify it without a call to auth.

- JWTs are good for scale and for machine-to-machine calls. There is no shared session store, and verification is a local signature check.
- Revocation is not immediate. A JWT stays valid until it expires. No service has to call auth to check it. That is the purpose of a JWT, and it is also why you cannot cancel one early. Thus you keep the lifetime short, usually 10 to 15 minutes, and make a new JWT when the old one expires.

A cookie is only a method to carry the token. It is not a different approach. The web app keeps the token in an httpOnly, Secure, SameSite cookie, so JavaScript cannot read it. This prevents token theft through XSS, but you must still prevent CSRF. Mobile calls and service-to-service calls send the same token in an `Authorization: Bearer` header.

Thus I divided it as follows:

- **Sessions for humans.** better-auth keeps the session in our database. Thus a logout, "sign out everywhere," and a password change all have an immediate effect. The expiry moves forward automatically. A session has a lifetime of 7 days. When the session is more than one day old, each use moves the expiry forward again. There is no separate refresh token to monitor, because the session is the refresh.
- **JWTs for machines and cross-service calls.** When a request goes across a service boundary, it carries a short-lived JWT, and the receiving service verifies it locally. We make one from the session with `authClient.token()`, keep it, and attach it to outgoing calls. Its lifetime is 15 minutes. Thus we make a new one at intervals of some minutes, and also when a call returns a 401.

---

## better-auth

I used [better-auth](https://better-auth.com) for this. It is a TypeScript-native auth library that you host fully yourself. It owns tables in our database and runs in our backend, and all the user data stays with us. Vercel [acquired the team](https://vercel.com/blog/vercel-acquires-better-auth) recently :)

The core gives you email/password and sessions. All other functions are plugins. Each plugin brings its own database schema, server routes, and an applicable client helper. The plugins that I used agree almost one-to-one with the requirements above:

- `organization()` - orgs, members, invitations, roles, and the active organization.
- `apiKey()` - to issue, hash, and verify API keys.
- `jwt()` - to issue JWTs and supply a JWKS endpoint, so other services can verify tokens locally.
- `sso()` - enterprise SSO through OIDC/SAML.
- `scim()` - enterprise SCIM for directory sync.
- `admin()` - impersonation, user management, and access-control primitives.

---

## better-auth plugins

The core setup is small. You make the auth instance from plugins:

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

On the client, each server plugin has a related client plugin. Thus the methods that it adds have full types:

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

We needed role-based access control. You do not give permissions to users. You give permissions to roles, then you put users in roles. To change what an admin can do, you edit one role. You do not have to update each user row.

It has three layers.

1. **Permissions.** The smallest unit. Each permission is a resource and an action: `project:delete`, `member:invite`, ...
2. **Roles.** Named groups of permissions: `member`, `admin`, `owner`.
3. **Membership.** The link between a user and a role.

A user does not get a global role. A user gets a role in each organization.

```ts
// a user can belong to many orgs; switching sets the active one on the session
await authClient.organization.setActive({ organizationId });

// membership carries a role scoped to that org
await authClient.organization.inviteMember({
  email: "janaki@gmail.com",
  role: "admin",
});
```

This code defines the permissions and the roles that use them:

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

Then give those roles to the plugin. If you do not, the plugin uses its own built-in roles:

```ts
organization({ ac, roles: { member, admin, owner } })
```

A permission check then looks like this. You do not need `if (user.role === "admin")` in many locations in the codebase:

```ts
const { success } = await auth.api.hasPermission({
  headers,
  body: { permissions: { project: ["delete"] } },
});
```

Roles are made from small permissions, not from hard-coded strings. Thus a new capability is a one-line change in one location.

---

## Login methods: OAuth, SSO, SCIM

OAuth (social login) - "Sign in with Google/GitHub." We send the user to the provider. The user gives approval and comes back with an authorization code, which we exchange for their profile. PKCE prevents theft of that code on public clients such as mobile apps. better-auth does the flow.

SSO (enterprise identity) - When you sell to companies, they want their employees to log in through their own identity provider (Okta, Entra, Google Workspace) with OIDC or SAML. The IT team of the customer controls access, and the email domain selects the login.

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

SCIM (provisioning) - SSO lets people in, and SCIM keeps the user list in sync. When a large company starts to use the product, it does not want to invite users one at a time. And when a person leaves the company, their access must be removed everywhere automatically. SCIM is a standard REST protocol. The IdP of the company calls it to create, update, and deactivate users in our system. It is the feature for "a person was dismissed on Friday and must have no access by Friday". A SCIM deprovision event marks the member as inactive and revokes their sessions immediately.

---

## Architecture: how everything talks to auth

1. **User → auth.** A person logs in and gets a session (a cookie on web, a bearer token on mobile).
2. **Service → auth.** A backend service logs in as itself (client-credentials style) to get a short-lived token. This is for calls that have no user, such as a cron job or an internal job runner.
3. **Service → service.** One service calls a different service and passes the token. The receiving service must verify it.

The simple version of #3 is very bad: each service calls auth on each request to ask "is this token valid?". Then auth is in front of 100% of the traffic, and its latency is added to each request. If auth stops, all services stop.

The solution is to issue tokens in one location but verify them everywhere, with JWKS:

- Auth is the only issuer. It holds the private signing key and makes each JWT.
- Auth publishes the related public keys at a JWKS endpoint. Point the other services to that endpoint, or proxy the well-known path to it.
- Each other service gets those keys one time, caches them, and verifies tokens locally. This is a signature check in memory, with no network call to auth on each request.

Local verification in a different service looks like this:

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

Key rotation keeps this safe as time passes. Each key has a `kid` (key id) in the JWT header. To rotate, auth starts to sign with a new key but continues to publish the old public key. Thus the tokens that are already issued continue to work. When those old tokens have expired, auth removes the old key. Each service selects the correct key by `kid` independently, so the services do not have to change keys at the same time.

---

## API keys

API keys are the path with no browser and no user session. They are for customers who write scripts or automations for the API, and for integrations:

- **Hashed at rest.** The user sees the full key one time, at creation. We keep only a hash, so a database leak does not leak keys that can be used.
- **Scoped and attributable.** A key belongs to a user and an org and has its own set of permissions. Thus it can have fewer permissions than the person who created it.

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

The server must check an API key against the database. A JWT contains its own claims, so it needs only a signature check. The key proves your identity at the edge. From there, we map it back to the same user/org/permission model that all other parts use:

1. `verifyApiKey` gives us the key record: the user that it belongs to, the org in which it was created, and the permissions kept on it.
2. We load the membership of that user in the org. This gives us their role and all that the role permits.
3. The permissions that we apply are the intersection of the two. Thus a key cannot do more than the person who created it. If that person gets a lower role or is removed from the org, the permissions of their keys decrease too.

---

## References

1. [better-auth documentation](https://better-auth.com)
2. [BoxyHQ](https://boxyhq.com)
3. [Ory](https://www.ory.sh)
4. [Okta](https://developer.okta.com)
5. [WorkOS](https://workos.com)
