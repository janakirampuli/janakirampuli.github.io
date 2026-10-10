---
layout: post
title: "Authorization with ReBAC"
date: 2026-09-19
tags: ["authz", "rebac", "cedar", "backend", "systems"]
published: true
---

These are notes on relationship-based access control (ReBAC). They show how ReBAC controls sharing and permissions across resources, and how to build it on [Cedar](https://www.cedarpolicy.com/).

The [auth service post](/_posts/auth-service.html) was about authentication, which answers "who are you?". This post is about authorization: when we know who you are, can you do this action on this resource?

```
principal  +  action     +  resource              ->   allow / deny

alice      +  ViewPhoto  +  VacationPhoto94.jpg   ->   ?
```

The examples use PhotoFlash, the photo-sharing app from the Cedar docs. It has users, groups, albums, and photos.

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
| RBAC (role-based) | a role has permissions, and users have roles | jane is `admin`, and `admin` can delete albums |
| ABAC (attribute-based) | a condition on attributes | allow if `photo.sensitive == false` or `user.age >= 18` |
| ReBAC (relationship-based) | a path through a graph of relationships | alice is in a group that can view the album that contains this photo |

ACLs are precise, but they grow by one row for each object and each person. RBAC decreases that to a small number of role names. ABAC is the most expressive model and the most difficult to analyze, because the answer changes with attribute values that can change at any time. ReBAC is less expressive than ABAC, but the answer comes from relationships that you already keep.

---

## Where RBAC is not sufficient

For example, a photo club shares one account, with 30 albums and 4,000 photos. Jane wants alice to see the photos in her trips album and no other photos.

Plain RBAC gives you global roles. If alice has `viewer`, she can view each album in the club. Thus you limit the role to a resource: "alice is viewer on janeTrips". That works until one of these occurs:

- Jane adds bob as a friend and wants him to see what her other friends see. That is a new row for each album that she shared with them.
- A person asks who can see a specified photo. You examine the photo, then its album, then the account-wide shares, all manually.

RBAC does not know that a photo is in an album. Thus "viewer on the album" becomes "can view this photo" only if you write that rule yourself. You must write it in each endpoint, for each resource type.

---

## What ReBAC is

In ReBAC you keep relationships, and a permission check becomes a question about a graph. Is there a path from this principal to this resource that permits this action?

Three types of edge are sufficient for most products:

1. A principal has a role on a resource. This is the grant.
2. A principal is a member of a group.
3. A resource is inside a different resource.

The alice example again:

```
alice --member--> janeFriends --viewer--> janeTrips
                                              ^
                                              | parent
                                     VacationPhoto94.jpg
```

Alice is in `janeFriends`, that group is `viewer` on `janeTrips`, and the photo is in `janeTrips`. Thus she can view it.

The share from Jane is one grant. It includes each photo in the album, and also the photos that are added later. When Jane adds bob to the group, he gets the same access without a new grant. The other two edges are group membership and the album of a photo. The app keeps this data in all cases.

The idea comes from the [Zanzibar](https://research.google/pubs/pub48190/) paper from Google, which I recommend that you read. It describes the system that controls sharing in Drive, Photos, and YouTube.

---

## Roles

Each grant has a role. Roles are cumulative, so each role includes all the roles below it:

- `viewer` can see the resource.
- `contributor` can also add to it: photos to an album, comments on a photo.
- `editor` can also change it: rename the album, edit its photos.
- `admin` has full control, which includes the location where each photo was taken.

Each action is permitted from a minimum role and above: `ViewPhoto` from `viewer`, `EditPhoto` from `editor`.

The check to create an item uses its container: to add a photo, you must have `contributor` on the album. You cannot have a role on an item that does not exist.

Some actions do not apply to one resource, such as to create an album or to manage groups. Those stay plain RBAC, with account-wide roles such as admin and member. A grant does not give an account role: the admin of one album cannot create groups.

---

## Hierarchy and inheritance

Access goes down the "is inside" edges. Thus the parent of a resource is the primary decision when you add a resource type. The parent of an album is its account. The parents of a photo are the albums that contain it. There can be more than one, because the same photo can be in Trips and Favorites.

A new upload stays in the library of its owner until a person puts it in an album. If it inherited from the account, the full club could see each upload immediately. Thus it has no parent, and its owner gets access from a built-in rule that does not need a grant.

---

## Choosing an engine

Two types of policy engine can go through the graph and answer the question.

Zanzibar-style services such as [OpenFGA](https://openfga.dev) and [SpiceDB](https://authzed.com/spicedb) own the data and the evaluation. You write relationships into them and ask "can alice view VacationPhoto94.jpg?". They also directly answer the more difficult question, "what can alice reach?". The cost is a second service on the request path. There is also a second copy of your relationships, which must stay in sync with your database.

[Cedar](https://www.cedarpolicy.com/) is a policy language from AWS with an evaluator. It comes as a Rust library with WASM bindings. It runs in-process and keeps no data: you give it the policies, the related entities, and the request, and it answers. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/) is the hosted version.

This blog post uses Cedar. Grants are in the same database as their resources. Thus a resource and its first grant go to one database, not to two systems that can fail independently.

The trade-off is that you must load the related relationships yourself before each decision. You must also write the "what can alice reach?" query manually.

---

## Defining the schema

The schema tells Cedar which types of entities exist, which entity can contain which, and which actions apply to which types. In the Cedar schema language:

```
entity Account;
entity Group in [Account];
entity User in [Group, Account];
entity Album in [Account];
entity Photo in [Album] { owner: User };

action ViewAlbum, RenameAlbum appliesTo { principal: User, resource: Album };
action ViewPhoto, EditPhoto   appliesTo { principal: User, resource: Photo };
```

`in` declares the hierarchy: a user can be a member of groups and of an account, and a photo can be in albums. These are the membership edges and the "is inside" edges of the graph. `appliesTo` gives the principal type and the resource type of each action. The Cedar validator uses it to reject a policy that permits `RenameAlbum` on a photo.

In practice, each entity also has an `accountId`, and each user has an account-wide role, for the built-in rules below. They are not shown here, to keep the example short.

---

## Writing policies

A policy says who can do what, on which resources. The share from Jane, written manually, is:

```
permit(
  principal in Group::"janeFriends",
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in Album::"janeTrips"
);
```

If you write one of these for each share, you get one policy for each grant row. As an alternative, each role gets one template, which is the same policy with placeholders.

```
permit(
  principal in ?principal,
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in ?resource
);
```

This is the `viewer` template. The templates of the other roles are different only in their action lists. At request time, each related grant links the template to its own principal and resource. Thus the grant row from Jane changes it back into the first policy.

All the inheritance comes from `in`, which matches the named entity or an entity below it:

- `principal in ?principal`: a grant to `janeFriends` includes each member of the group.
- `resource in ?resource`: a grant on `janeTrips` includes each photo in it.

In addition to the role templates, some built-in policies do not come from grants. These are the owner rule from the hierarchy section, the permits for the account-wide roles, and the tenant boundary below.

---

## Guardrails with forbid

The tenant boundary keeps each request in one account, and it is a `forbid`:

```
forbid(principal, action, resource)
unless { principal has accountId && resource has accountId
         && principal.accountId == resource.accountId };
```

Cedar makes its decision in a fixed order. If a `forbid` matches, the answer is deny. If not, the answer is allow only if a `permit` matches.

The `has` checks are necessary because of how Cedar handles errors. A policy can cause an error, for example when it reads an attribute that does not exist. Cedar ignores that policy and does not count it as a deny. For a `permit`, this has no bad effect. For a `forbid`, the guardrail goes off without a message. With the `has` checks, a missing account id makes the forbid match, and no error occurs.

---

## Evaluating a request

A route declares the action that it needs, such as `ViewPhoto` on a photo. Before the call to Cedar, the server loads only the part of the graph that can be important:

1. the groups of the caller,
2. the ancestors of the resource (for a photo, its albums),
3. the unexpired grants on the resource or its ancestors that belong to the caller, their groups, or the account.

The grants table can be large, but a check loads only a small number of rows from it. Those rows become the three inputs of Cedar. For alice:

```
request    User::"alice", Action::"ViewPhoto", Photo::"VacationPhoto94.jpg"

entities   User::"alice"                 in Group::"janeFriends", Account::"photoclub"
           Group::"janeFriends"          in Account::"photoclub"
           Photo::"VacationPhoto94.jpg"  in Album::"janeTrips"
           Album::"janeTrips"            in Account::"photoclub"

policies   viewer template linked to (Group::"janeFriends", Album::"janeTrips")
           built-in policies
```

Cedar then evaluates each policy against the request:

- The tenant boundary does not match, because alice and the photo are in the same account.
- The viewer link matches: alice is in `janeFriends`, `ViewPhoto` is in the viewer action list, and the photo is in `janeTrips`.

No forbid matched and a permit matched, so the decision is allow. Together with the decision, Cedar returns the policies that made the decision and the errors, if there are any. If you log these policies, you can see which rule denied a request, such as the tenant boundary.

---

## Listing what someone can see

A check answers one question about one resource. A list page cannot run the check on each photo in the account and discard most of them. Thus a list works in the opposite direction:

1. Load each unexpired grant that the caller has, directly or through a group or the account.
2. Expand each grant down the hierarchy: a grant on an album includes the photos in it.
3. If more than one path goes to the same photo, keep the highest role.

For example, the caller has a direct `viewer` grant on a photo, and the photo is in an album that the caller can edit. The result for that photo is `editor`. Each id comes back with its role. Thus the grid can show or hide the edit and share buttons of each photo without a second request.

---

## Sharing

A share creates or updates a grant: a principal, a resource, a role, and an optional expiry. The principal can be a user, a group, or all the users in the account. The code ignores expired grants when it loads grants, so temporary access stops without a cleanup job.

A share is also an action, so it goes through the same check as all other actions. Apps usually permit it for editors and sometimes only for admins. Viewers cannot share again. Two more rules are common:

- You cannot give a person a role higher than your own.
- A resource always keeps a minimum of one admin. Thus the last admin cannot be removed or given a lower role.

---

## Adding a new resource type

For example, you add slideshows, which are in albums:

1. Add `entity Slideshow in [Album]` to the schema, with an `accountId` as for all other entities.
2. Declare its actions and add each action to the role that permits it: `ViewSlideshow` to `viewer`, `EditSlideshow` to `editor`. To create a slideshow is an action on the album, the same as to add a photo.
3. Make sure that the code that loads the ancestors of a resource can find the album of a slideshow.
4. Protect its routes with the actions that they need.
5. When a slideshow is created, write the `admin` grant of the creator and the link to the album.

New policies are not necessary here. Slideshows inherit access through `in`, as photos do.

---

## References

1. [Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/pub48190/)
2. [Cedar policy language](https://www.cedarpolicy.com/)
3. [Cedar authorization: how decisions are made](https://docs.cedarpolicy.com/auth/authorization.html)
4. [OpenFGA](https://openfga.dev)
5. [SpiceDB](https://authzed.com/spicedb)
6. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/)
