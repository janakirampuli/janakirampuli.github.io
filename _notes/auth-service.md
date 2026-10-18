---
layout: notes
title: "Building an Auth Service"
date: 2026-07-25
tags: ["auth", "backend", "systems"]
published: true
---

I built our auth service on [better-auth](https://better-auth.com), which is a TypeScript auth library that we host ourselves. Users get sessions that are stored in our database, and services get short-lived signed tokens that other services verify without calling the auth service. This note gives the requirements, explains the concepts that I had to learn, and shows how better-auth covers each requirement.

## Contents

<div class="ia-toc" markdown="1">

- [User authentication and service authentication](#user-authentication-and-service-authentication)
- [Requirements](#requirements)
- [Authenticating a request](#authenticating-a-request)
- [Sessions, JWTs, cookies, and revocation](#sessions-jwts-cookies-and-revocation)
- [better-auth](#better-auth)
- [better-auth plugins](#better-auth-plugins)
- [Organizations, roles, and permissions](#organizations-roles-and-permissions)
- [Login methods with OAuth, SSO, and SCIM](#login-methods-with-oauth-sso-and-scim)
- [How users and services call the auth service](#how-users-and-services-call-the-auth-service)
- [API keys](#api-keys)
- [References](#references)

</div>

---

## User authentication and service authentication

An auth service has to identify users, and it also has to identify services.

User authentication happens when a person opens the web app or the mobile app and proves their identity with a password, a Google login, or their company's login system. The auth service then gives the user a session.

Service authentication happens when a backend service calls another service, or calls the auth service itself, and no user is involved. The service also needs an identity and a set of permissions.

---

## Requirements

The auth service had to meet the following requirements.

- Login
  - Users can log in from the web app and the mobile app with one identity.
  - Enterprise customers can use OAuth (social login), SSO (login through the company's identity provider), and SCIM (automatic creation and removal of users).
- Authorization
  - Each request is authenticated and authorized, which means that the server checks whether the caller is logged in and whether the caller can do the action.
  - Users belong to organizations, and a user can be a member of more than one organization. The session contains an active organization, which is the organization that the user is working in at the time, and every permission check uses the active organization.
  - Each organization has roles, e.g., owner, admin, and member, and a user's role in the active organization controls what the user can do. The same person can be an owner in one organization and a viewer in another. The model is called role-based access control (RBAC).
- Access without a browser
  - Users can create API keys for scripts and integrations, and an API key isn't tied to a browser session.
  - A backend service can get a token and verify a token when no user is involved.

---

## Authenticating a request

On each request, the auth service has to find out who is making the call and whether they have permission to make it.

An HTTP request is anonymous by default, so the client must attach proof of identity. The proof is either a bearer token or a session cookie.

A bearer token is a string that the client sends in a header on each request.

```
Authorization: Bearer <token>
```
{: .no-copy}

The token is the credential, so the server treats anyone who holds the token as that user. Mobile apps and backend services use bearer tokens.

A session cookie is a cookie that the server sets after login, and the browser attaches it to each later request automatically. The cookie either contains the credential or contains an id that points to it. The web app uses a session cookie.

The server does the same two checks on each request, whichever proof the client sends. First, authentication finds out who the caller is. The server reads the token or the cookie from the request and checks that it is valid, and then it finds the user or the service that it identifies. Second, authorization finds out what the caller can do. The server looks up the roles and permissions of the caller in the active organization before it permits the action.

Authentication happens on every request, and login is only the first time. A user enters a password or logs in with Google once, and the server still has to check each later request. The later check is cheaper, because the server only reads the token or looks up the session by its id. Authorization runs on each protected action, e.g., when a user tries to delete a resource in an organization.

---

## Sessions, JWTs, cookies, and revocation

Sessions and JWTs are the two common ways to keep a caller logged in, and they differ mainly in how quickly you can revoke access.

With sessions, the server creates a random session id and stores the session in a database. The server gives the id to the client, and it looks up the session on each request. Sessions are stateful, which means that the server stores them. Revocation is easy, because the session stops working as soon as you delete its row. The cost is a lookup on each request, usually in a database or a cache, and each service that verifies a session needs access to that store.

A JWT (JSON Web Token) is a signed token that contains claims, e.g., the user id, the active organization, the roles, and the expiry time. JWTs are stateless, which means that the server doesn't store them. Any service that has the public key can verify a JWT without calling the auth service. JWTs suit high traffic and service-to-service calls, because there is no shared session store and verification is a local signature check. Revocation isn't immediate, because a JWT stays valid until it expires and no service asks the auth service about it. So you keep the lifetime short, usually 10 to 15 minutes, and you issue a new JWT when the old one expires.

A cookie is a way to carry a token, and it works with either approach. The web app keeps the token in a cookie with the httpOnly, Secure, and SameSite attributes, so JavaScript on the page can't read it. The httpOnly attribute stops a script that an attacker injected into the page from stealing the token, and the attack is called cross-site scripting (XSS). You still have to defend against cross-site request forgery (CSRF), in which another site makes the browser send a request with the user's cookie. Mobile calls and service-to-service calls send the same token in an `Authorization: Bearer` header.

I use sessions for users, and I use JWTs for services and for calls between services.

better-auth keeps each user session in our database, so a logout, a "sign out everywhere" action, and a password change take effect immediately. A session lasts 7 days. Once a session is more than one day old, each use moves the expiry forward again. We don't need a separate refresh token, because using the session extends it.

A request that crosses a service boundary carries a short-lived JWT, and the receiving service verifies the JWT locally. We create the JWT from the session with `authClient.token()` and attach it to outgoing calls. The JWT lasts 15 minutes, so we create a new one every few minutes, and also when a call returns a 401 response.

---

## better-auth

I used [better-auth](https://better-auth.com) for the implementation. better-auth is a TypeScript auth library that you host yourself. It creates its tables in our database and runs in our backend, so all the user data stays with us. Vercel recently [acquired the team](https://vercel.com/blog/vercel-acquires-better-auth).

The core of better-auth provides email and password login and sessions, and every other feature is a plugin. Each plugin adds its own database schema, server routes, and client helper. The plugins that I used match the requirements almost one for one.

- Organizations and access control
  - `organization()` adds organizations, members, invitations, roles, and the active organization.
  - `admin()` adds impersonation, user management, and access control functions.
- Tokens and keys
  - `apiKey()` issues, hashes, and verifies API keys.
  - `jwt()` issues JWTs and serves a JWKS endpoint, which publishes the public keys that other services use to verify tokens locally.
- Enterprise login
  - `sso()` adds enterprise SSO through the OIDC or SAML protocol.
  - `scim()` adds SCIM, which syncs our user list with a customer's directory.

---

## better-auth plugins

The core setup is small, because you build the auth instance from a list of plugins.

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

On the client, each server plugin has a matching client plugin, so the methods that the plugin adds are fully typed.

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

## Organizations, roles, and permissions

We needed role-based access control, in which you give permissions to roles and then put users in roles. To change what an admin can do, you edit one role, and you don't have to update each user row.

Role-based access control is built from permissions, roles, and memberships.

1. A permission is the smallest unit. Each permission is a resource and an action, e.g., `project:delete` or `member:invite`.
2. A role is a named group of permissions, e.g., `member`, `admin`, or `owner`.
3. A membership links a user to a role in one organization.

A user gets a separate role in each organization, and there is no global role.

```ts
// a user can belong to many orgs; switching sets the active one on the session
await authClient.organization.setActive({ organizationId });

// membership carries a role scoped to that org
await authClient.organization.inviteMember({
  email: "janaki@gmail.com",
  role: "admin",
});
```

The following code defines the permissions and the roles that use them.

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

Then you pass the roles to the plugin. If you don't, the plugin uses its built-in roles.

```ts
organization({ ac, roles: { member, admin, owner } })
```

A permission check then looks like the following code, and you don't need `if (user.role === "admin")` checks spread across the codebase.

```ts
const { success } = await auth.api.hasPermission({
  headers,
  body: { permissions: { project: ["delete"] } },
});
```

Roles are built from small permissions instead of hard-coded strings, so adding a new capability is a one-line change in one place.

---

## Login methods with OAuth, SSO, and SCIM

OAuth is the protocol behind social login, e.g., "Sign in with Google". We send the user to the provider, and the user approves the login. The provider sends the user back with an authorization code, which we exchange for the user's profile. PKCE (Proof Key for Code Exchange) is an extension that stops an attacker from using a stolen code, and it is needed on public clients such as mobile apps. better-auth handles the whole flow.

SSO (single sign-on) lets a company's employees log in through the company's own identity provider, e.g., Okta, Entra, or Google Workspace. An identity provider is the system that stores a company's user accounts. Companies ask for SSO when they buy the product, and SSO uses the OIDC or SAML protocol. The customer's IT team controls who has access, and the user's email domain decides which identity provider handles the login.

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

SCIM (System for Cross-domain Identity Management) keeps our user list in sync with the customer's identity provider. A large company doesn't want to invite users one at a time, and it wants access removed automatically when a person leaves. SCIM is a standard REST protocol, and the customer's identity provider calls it to create, update, and deactivate users in our system. For example, if a person leaves the company on Friday, their access should end on Friday. When we receive a SCIM request to deactivate a user, we mark the member as inactive and revoke their sessions immediately.

---

## How users and services call the auth service

The auth service issues every token, and the other services verify tokens themselves without calling it.

Tokens move between users, services, and the auth service in the following ways. First, a user logs in to the auth service and gets a session, which is a cookie on the web app and a bearer token on the mobile app. Second, a backend service logs in as itself with its own client id and secret, in the style of the OAuth client credentials flow, and gets a short-lived token. Services do so for calls that have no user, such as a cron job or an internal job runner. Third, one service calls another service and passes the token, and the receiving service must verify it.

The simplest way to verify the token in the third case is for each service to ask the auth service whether the token is valid, on every request. Then every request in the system passes through the auth service, and its latency is added to each request. If the auth service goes down, all services stop working.

The solution is to issue tokens in one place and verify them in every service, using JWKS (JSON Web Key Set), which is a standard format for publishing public keys.

- The auth service is the only issuer. It holds the private signing key and creates each JWT.
- The auth service publishes the matching public keys at a JWKS endpoint. You point the other services at the endpoint, or you proxy the well-known path to it.
- Each other service fetches the keys once, caches them, and verifies tokens locally. Verification is a signature check in memory, with no network call to the auth service.

Local verification in another service looks like the following code.

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

Key rotation lets you replace the signing key without breaking tokens that are already issued. Each key has a key id, called `kid`, in the JWT header. To rotate, the auth service starts signing with a new key and keeps publishing the old public key, so existing tokens still verify. After the old tokens expire, the auth service removes the old key. Each service picks the correct key by `kid` on its own, so the services don't have to switch keys at the same time.

---

## API keys

API keys give access without a browser or a user session. Customers use them in scripts, automations, and integrations.

- We store only a hash of each key. The user sees the full key once, at creation, so a database leak doesn't expose keys that can be used.
- Each key belongs to a user and an organization, and it has its own set of permissions. A key can therefore have fewer permissions than the user who created it.

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

The server has to check an API key against the database, unlike a JWT, which contains its own claims and needs only a signature check. After the key identifies the caller, we map it to the same user, organization, and permission model that the rest of the system uses.

1. `verifyApiKey` returns the key record, which holds the user that owns the key, the organization in which the key was created, and the permissions stored on the key.
2. We load the user's membership in the organization, which gives us the user's role and the permissions of the role.
3. We apply the intersection of the key's permissions and the role's permissions, so a key can't do more than the user who created it. If the user gets a lower role or is removed from the organization, the permissions of their keys decrease too.

---

## References

1. [better-auth documentation](https://better-auth.com)
2. [BoxyHQ](https://boxyhq.com)
3. [Ory](https://www.ory.sh)
4. [Okta](https://developer.okta.com)
5. [WorkOS](https://workos.com)
