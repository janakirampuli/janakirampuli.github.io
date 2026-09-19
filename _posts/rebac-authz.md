---
layout: post
title: "Authorization with ReBAC"
date: 2026-09-19
tags: ["authz", "rebac", "cedar", "backend", "systems"]
published: true
---

Notes on relationship-based access control (ReBAC): how it handles sharing and permissions across resources, and how to build it on top of [Cedar](https://www.cedarpolicy.com/).

The [auth service post](/_posts/auth-service.html) covered authentication, which answers "who are you?". This one is about authorization: given who you are, can you do this action on this resource?

```
principal  +  action     +  resource              ->   allow / deny

alice      +  ViewPhoto  +  VacationPhoto94.jpg   ->   ?
```

The examples use PhotoFlash, the photo-sharing app from the Cedar docs: users, groups, albums, and photos.

## Contents

<div class="ia-toc" markdown="1">

- [Ways to model permissions: ACL, RBAC, ABAC, ReBAC](#ways-to-model-permissions-acl-rbac-abac-rebac)
- [Where RBAC is not sufficient](#where-rbac-is-not-sufficient)
- [What ReBAC is](#what-rebac-is)
- [Roles](#roles)
- [Hierarchy and inheritance](#hierarchy-and-inheritance)
- [Choosing an engine](#choosing-an-engine)
- [Defining the schema](#defining-the-schema)
- [Writing policies](#writing-policies)
- [Guardrails with forbid](#guardrails-with-forbid)
- [Evaluating a request](#evaluating-a-request)
- [Listing what someone can see](#listing-what-someone-can-see)
- [Sharing](#sharing)
- [Adding a new resource type](#adding-a-new-resource-type)
- [References](#references)

</div>

---

## Ways to model permissions: ACL, RBAC, ABAC, ReBAC

| model | the rule is | example |
|---|---|---|
| ACL (access control list) | a list attached to each object | `VacationPhoto94.jpg: {alice: view, bob: edit}` |
| RBAC (role-based) | a role carries permissions, users hold roles | jane is `admin`, and `admin` can delete albums |
| ABAC (attribute-based) | a condition over attributes | allow if `photo.sensitive == false` or `user.age >= 18` |
| ReBAC (relationship-based) | a path through a graph of relationships | alice is in a group that can view the album this photo is in |

ACLs are precise but grow one row per object per person. RBAC reduces that to a few role names. ABAC is the most expressive and the hardest to reason about, because the answer depends on attribute values that can change at any time. ReBAC is less expressive than ABAC, but the answer comes from relationships you already store.

---

## Where RBAC is not sufficient

Say a photo club shares one account, with 30 albums and 4,000 photos. Jane wants alice to see the photos in her trips album and nothing else.

Plain RBAC gives you global roles: if alice holds `viewer`, she can view every album in the club. So you scope the role to a resource, "alice is viewer on janeTrips". That works until:

- Jane adds bob as a friend and wants him to see what her other friends see. That's a new row for every album she has shared with them.
- Someone asks who can see a particular photo. You check the photo, then its album, then any account-wide shares, all by hand.

RBAC doesn't know that a photo is inside an album, so "viewer on the album" only becomes "can view this photo" if you write that rule yourself, in every endpoint, for every resource type.

---

## What ReBAC is

In ReBAC you store relationships, and a permission check becomes a question about a graph: is there a path from this principal to this resource that allows this action?

Three kinds of edge cover most products:

1. A principal holds a role on a resource. This is the grant.
2. A principal belongs to a group.
3. A resource sits inside another resource.

Back to alice:

```
alice --member--> janeFriends --viewer--> janeTrips
                                              ^
                                              | parent
                                     VacationPhoto94.jpg
```

Alice is in `janeFriends`, that group is `viewer` on `janeTrips`, and the photo is in `janeTrips`, so she can view it.

Jane's share is a single grant, and it covers every photo in the album, including ones added later. Adding bob to the group gives him the same access without a new grant. The other two edges, group membership and which album a photo is in, are data the app keeps anyway.

The idea comes from Google's [Zanzibar](https://research.google/pubs/pub48190/) paper (give it a read), which describes the system behind sharing in Drive, Photos, and YouTube.

---

## Roles

Every grant carries a role. Roles are cumulative, so each one includes everything below it:

- `viewer` can see the resource.
- `contributor` can also add to it: photos to an album, comments on a photo.
- `editor` can also change it: rename the album, edit its photos.
- `admin` has full control, including where each photo was taken.

Each action is allowed from some minimum role upward: `ViewPhoto` from `viewer`, `EditPhoto` from `editor`.

Creating something is checked against its container: adding a photo needs `contributor` on the album. You can't hold a role on something that doesn't exist yet.

Some actions aren't about any one resource, like creating an album or managing groups. Those stay plain RBAC, with account-wide roles such as admin and member. A grant never gives an account role: being admin of one album doesn't let you create groups.

---

## Hierarchy and inheritance

Access flows down the "sits inside" edges, so choosing a resource's parent is the main decision when you add a resource type. An album's parent is its account. A photo's parents are the albums it's in, and there can be several, since the same photo can be in Trips and Favorites.

A fresh upload sits in its owner's library until someone puts it in an album. If it inherited from the account, every upload would be visible to the whole club the moment it landed. So it has no parent at all, and its owner gets access from a built-in rule that doesn't need a grant.

---

## Choosing an engine

Two kinds of policy engine can walk the graph and answer the question.

Zanzibar-style services such as [OpenFGA](https://openfga.dev) and [SpiceDB](https://authzed.com/spicedb) own both the data and the evaluation. You write relationships into them and ask "can alice view VacationPhoto94.jpg?". They also answer the harder question, "what can alice reach?", directly. The cost is a second service on the request path, and a second copy of your relationships that has to stay in sync with your database.

[Cedar](https://www.cedarpolicy.com/) is a policy language from AWS plus an evaluator, shipped as a Rust library with WASM bindings. It runs in-process and stores nothing: you pass it the policies, the entities involved, and the request, and it answers. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/) is the hosted version.

This blog post uses Cedar. Grants live in the same database as the resources they're about, so a resource and its first grant go to one database instead of two systems that can fail separately.

The trade-off is that you load the relevant relationships yourself before each decision, and you write the "what can alice reach?" query by hand.

---

## Defining the schema

The schema tells Cedar what kinds of entities exist, what can contain what, and which actions apply to which types. In Cedar's schema language:

```
entity Account;
entity Group in [Account];
entity User in [Group, Account];
entity Album in [Account];
entity Photo in [Album] { owner: User };

action ViewAlbum, RenameAlbum appliesTo { principal: User, resource: Album };
action ViewPhoto, EditPhoto   appliesTo { principal: User, resource: Photo };
```

`in` declares the hierarchy: a user can be a member of groups and of an account, and a photo can sit in albums. These are the membership and "sits inside" edges of the graph. `appliesTo` says which principal and resource types each action takes, and Cedar's validator uses it to reject a policy that allows `RenameAlbum` on a photo.

In practice every entity also carries an `accountId`, and every user their account-wide role, for the built-in rules below. They're left out here to keep it short.

---

## Writing policies

A policy says who can do what, on which resources. Jane's share, written by hand, would be:

```
permit(
  principal in Group::"janeFriends",
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in Album::"janeTrips"
);
```

Writing one of these for every share would mean a policy per grant row. Instead, each role gets one template: the same policy with placeholders.

```
permit(
  principal in ?principal,
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in ?resource
);
```

This is the `viewer` template; the other roles' templates differ only in their action lists. At request time each relevant grant links the template to its own principal and resource, so jane's grant row turns it back into the first policy.

All of the inheritance comes from `in`, which matches the named entity or anything under it:

- `principal in ?principal`: a grant to `janeFriends` covers every member of the group.
- `resource in ?resource`: a grant on `janeTrips` covers every photo inside it.

Besides the role templates, a few built-in policies don't come from grants: the owner rule from earlier, permits for the account-wide roles, and the tenant boundary below.

---

## Guardrails with forbid

The tenant boundary keeps every request inside one account, and it's a `forbid`:

```
forbid(principal, action, resource)
unless { principal has accountId && resource has accountId
         && principal.accountId == resource.accountId };
```

Cedar decides in a fixed order: if any `forbid` matches, the answer is deny; otherwise it's allow only if some `permit` matches.

The `has` checks are there because of how Cedar handles errors. A policy that errors, for example by reading an attribute that isn't there, is skipped instead of counting as a deny. For a `permit` that's harmless. For a `forbid`, the guardrail silently switches off. With the `has` checks, a missing account id makes the forbid match instead of erroring.

---

## Evaluating a request

A route declares the action it needs, like `ViewPhoto` on a photo. Before calling Cedar, the server loads only the part of the graph that could matter:

1. the caller's groups,
2. the resource's ancestors (for a photo, its albums),
3. unexpired grants held by the caller, their groups, or the account, on the resource or its ancestors.

The grants table can be large, but a check only loads a handful of rows from it. Those rows become Cedar's three inputs. For alice:

```
request    User::"alice", Action::"ViewPhoto", Photo::"VacationPhoto94.jpg"

entities   User::"alice"                 in Group::"janeFriends", Account::"photoclub"
           Group::"janeFriends"          in Account::"photoclub"
           Photo::"VacationPhoto94.jpg"  in Album::"janeTrips"
           Album::"janeTrips"            in Account::"photoclub"

policies   viewer template linked to (Group::"janeFriends", Album::"janeTrips")
           built-in policies
```

Cedar then evaluates every policy against the request:

- The tenant boundary doesn't match, because alice and the photo are in the same account.
- The viewer link matches: alice is in `janeFriends`, `ViewPhoto` is in the viewer action list, and the photo is in `janeTrips`.

No forbid matched and a permit did, so the decision is allow. Along with the decision, Cedar returns the policies that decided it and any errors. Logging the deciding policies tells you which rule denied a request, such as the tenant boundary.

---

## Listing what someone can see

A check answers one question about one resource. A list page can't run it on every photo in the account and throw most away, so listing works in the other direction:

1. Load every unexpired grant the caller holds, directly or through a group or the account.
2. Expand each grant down the hierarchy: a grant on an album covers the photos in it.
3. Where more than one path reaches the same photo, keep the highest role.

A direct `viewer` grant on a photo in an album the caller can edit comes out as `editor`. The role comes back with each id, so the grid can show or hide each photo's edit and share buttons without another round trip.

---

## Sharing

Sharing creates or updates a grant: a principal, a resource, a role, and optionally an expiry. The principal can be a user, a group, or everyone in the account. Expired grants are skipped when grants are loaded, so temporary access ends without a cleanup job.

Sharing is itself an action, so it goes through the same check as everything else. Apps usually allow it for editors, sometimes only for admins, and viewers can't reshare. Two more rules are common:

- You can't give anyone a higher role than your own.
- A resource always keeps at least one admin, so the last one can't be removed or downgraded.

---

## Adding a new resource type

Say you're adding slideshows, which live inside albums:

1. Add `entity Slideshow in [Album]` to the schema, with an `accountId` like every other entity.
2. Declare its actions and add each to the role that allows it: `ViewSlideshow` to `viewer`, `EditSlideshow` to `editor`. Creating one is an action on the album, like adding a photo.
3. Make sure the code that loads a resource's ancestors can find a slideshow's album.
4. Protect its routes with the actions they need.
5. When a slideshow is created, write the creator's `admin` grant and its link to the album.

No new policies are needed here: slideshows inherit access through `in`, like photos do.

---

## References

1. [Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/pub48190/)
2. [Cedar policy language](https://www.cedarpolicy.com/)
3. [Cedar authorization: how decisions are made](https://docs.cedarpolicy.com/auth/authorization.html)
4. [OpenFGA](https://openfga.dev)
5. [SpiceDB](https://authzed.com/spicedb)
6. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/)
