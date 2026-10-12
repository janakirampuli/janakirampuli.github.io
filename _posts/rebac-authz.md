---
layout: post
title: "Authorization with ReBAC"
date: 2026-09-19
tags: ["authz", "rebac", "cedar", "backend", "systems"]
published: true
---

Relationship-based access control (ReBAC) decides a permission by looking for a path through relationships that the app stores, e.g., a user is in a group, the group can view an album, and the album contains a photo. This post explains how ReBAC handles sharing and permissions across resources, and how to build it on [Cedar](https://www.cedarpolicy.com/), which is a policy language from AWS.

The [auth service post](/_posts/auth-service.html) was about authentication, which finds out who the caller is. Authorization is the next step, and it decides whether a known caller can do an action on a resource. The caller is called the principal.

```
principal  +  action     +  resource              ->   allow / deny

alice      +  ViewPhoto  +  VacationPhoto94.jpg   ->   ?
```
{: .no-copy}

The examples use PhotoFlash, which is the photo-sharing app from the Cedar docs, and it has users, groups, albums, and photos.

## Contents

<div class="ia-toc" markdown="1">

- [Ways to model permissions](#ways-to-model-permissions)
- [Where RBAC is not sufficient](#where-rbac-is-not-sufficient)
- [What ReBAC is](#what-rebac-is)
- [Roles](#roles)
- [Hierarchy and inheritance](#hierarchy-and-inheritance)
- [Choosing an engine](#choosing-an-engine)
- [Defining the schema](#defining-the-schema)
- [Writing policies](#writing-policies)
- [Forbid policies and the tenant boundary](#forbid-policies-and-the-tenant-boundary)
- [Evaluating a request](#evaluating-a-request)
- [Listing what someone can see](#listing-what-someone-can-see)
- [Sharing](#sharing)
- [Adding a new resource type](#adding-a-new-resource-type)
- [References](#references)

</div>

---

## Ways to model permissions

The common ways to model permissions are ACL, RBAC, ABAC, and ReBAC.

| model | the rule is | example |
|---|---|---|
| ACL (access control list) | a list attached to each object | `VacationPhoto94.jpg: {alice: view, bob: edit}` |
| RBAC (role-based) | a role has permissions, and users have roles | jane is `admin`, and `admin` can delete albums |
| ABAC (attribute-based) | a condition on attributes | allow if `photo.sensitive == false` or `user.age >= 18` |
| ReBAC (relationship-based) | a path through a graph of relationships | alice is in a group that can view the album that contains this photo |

ACLs are precise, but they grow by one row for each object and each person. RBAC replaces those rows with a small number of role names. ABAC is the most expressive model and the hardest to analyze, because the answer depends on attribute values that can change at any time. ReBAC is less expressive than ABAC, but the answer comes from relationships that the app already stores.

---

## Where RBAC is not sufficient

RBAC doesn't work well when users share individual resources with each other. For example, a photo club shares one account that has 30 albums and 4,000 photos, and Jane wants alice to see only the photos in her trips album.

Plain RBAC gives you global roles, so if alice has `viewer`, she can view every album in the club. You can limit the role to one resource, e.g., "alice is viewer on janeTrips", but the approach breaks down in the following cases. First, when Jane adds bob as a friend and wants him to see what her other friends see, she needs a new row for each album that she shared with them. Second, when someone asks who can see a particular photo, you have to check the photo, then its album, then the account-wide shares, by hand.

RBAC has no record that a photo is in an album. So "viewer on the album" means "can view this photo" only if you write that rule yourself, and you have to write it in each endpoint for each resource type.

---

## What ReBAC is

In ReBAC you store relationships, and a permission check asks whether the graph of relationships has a path from the principal to the resource that permits the action.

Most products need only the following kinds of relationship.

1. A principal has a role on a resource. The relationship is called a grant.
2. A principal is a member of a group.
3. A resource is inside another resource.

The diagram shows the alice example.

```
alice --member--> janeFriends --viewer--> janeTrips
                                              ^
                                              | parent
                                     VacationPhoto94.jpg
```
{: .no-copy}

Alice is in `janeFriends`, and `janeFriends` is `viewer` on `janeTrips`. The photo is in `janeTrips`, so alice can view it.

Jane's share is one grant, and it covers every photo in the album, including photos that are added later. When Jane adds bob to the group, he gets the same access without a new grant. The other relationships are group membership and the album of a photo, and the app stores both anyway.

The idea comes from Google's [Zanzibar](https://research.google/pubs/pub48190/) paper, which describes the system that controls sharing in Drive, Photos, and YouTube. I recommend reading it.

---

## Roles

Each grant has a role, and roles are cumulative, so each role includes every role below it.

- `viewer` can see the resource.
- `contributor` can also add to it, e.g., photos to an album or comments on a photo.
- `editor` can also change it, e.g., rename the album or edit its photos.
- `admin` has full control, including access to the location where each photo was taken.

Each action requires a minimum role, e.g., `ViewPhoto` requires `viewer` and `EditPhoto` requires `editor`.

The check for creating an item uses the item's container, because you can't have a role on an item that doesn't exist yet. For example, to add a photo you need `contributor` on the album.

Some actions don't apply to one resource, e.g., creating an album or managing groups. Those actions stay plain RBAC, with account-wide roles such as admin and member. A grant doesn't give an account-wide role, so the admin of one album can't create groups.

---

## Hierarchy and inheritance

Access is inherited down the "is inside" relationships, so choosing the parent of a resource is the main decision when you add a resource type. The parent of an album is its account. The parents of a photo are the albums that contain it, and there can be more than one because the same photo can be in Trips and Favorites.

A new upload has no parent, and it stays in its owner's library until someone puts it in an album. If the upload inherited from the account, the whole club could see it immediately. The owner gets access from a built-in rule that doesn't need a grant.

---

## Choosing an engine

You can evaluate the graph with either a Zanzibar-style service or a policy library that runs inside your process.

Zanzibar-style services, e.g., [OpenFGA](https://openfga.dev) and [SpiceDB](https://authzed.com/spicedb), own both the data and the evaluation. You write relationships into the service and ask it whether alice can view VacationPhoto94.jpg. The service can also answer the harder question of which resources alice can reach. The cost is a second service on the request path, and a second copy of your relationships that must stay in sync with your database.

[Cedar](https://www.cedarpolicy.com/) is a policy language from AWS that comes with an evaluator. The evaluator is a Rust library with WebAssembly bindings, and it runs inside your process and stores no data. You give it the policies, the relevant entities, and the request, and it returns a decision. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/) is the hosted version.

I use Cedar in the rest of the post. The grants are stored in the same database as their resources, so a resource and its first grant are written to one database, instead of to two systems that can fail independently.

The trade-off is that you have to load the relevant relationships yourself before each decision. You also have to write the query that finds which resources alice can reach.

---

## Defining the schema

The schema tells Cedar which entity types exist, which entity can contain which, and which actions apply to which types. The following schema is written in the Cedar schema language.

```
entity Account;
entity Group in [Account];
entity User in [Group, Account];
entity Album in [Account];
entity Photo in [Album] { owner: User };

action ViewAlbum, RenameAlbum appliesTo { principal: User, resource: Album };
action ViewPhoto, EditPhoto   appliesTo { principal: User, resource: Photo };
```

The `in` keyword declares the hierarchy, e.g., a user can be a member of groups and of an account, and a photo can be in albums. The declarations correspond to the membership and "is inside" relationships in the graph. The `appliesTo` clause gives the principal type and the resource type of each action, and the Cedar validator uses it to reject a policy that permits `RenameAlbum` on a photo.

In practice, each entity also has an `accountId`, and each user has an account-wide role. The built-in rules use both, and I left them out of the schema to keep the example short.

---

## Writing policies

A policy says who can do which actions on which resources. Jane's share, written by hand, is the following policy.

```
permit(
  principal in Group::"janeFriends",
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in Album::"janeTrips"
);
```

Writing one policy per share gives you one policy for each grant row. Instead, each role gets one template, which is the same policy with placeholders.

```
permit(
  principal in ?principal,
  action in [Action::"ViewAlbum", Action::"ViewPhoto"],
  resource in ?resource
);
```

The template above is the `viewer` template, and the templates of the other roles differ only in their action lists. At request time, each relevant grant links the template to its own principal and resource, so Jane's grant row produces the first policy again.

All the inheritance comes from `in`, which matches the named entity or any entity below it.

- `principal in ?principal` means that a grant to `janeFriends` covers each member of the group.
- `resource in ?resource` means that a grant on `janeTrips` covers each photo in it.

Some built-in policies don't come from grants. They are the owner rule from the hierarchy section, the permits for the account-wide roles, and the tenant boundary.

---

## Forbid policies and the tenant boundary

The tenant boundary is a `forbid` policy that keeps each request inside one account. A tenant is one customer account.

```
forbid(principal, action, resource)
unless { principal has accountId && resource has accountId
         && principal.accountId == resource.accountId };
```

Cedar decides in a fixed order. If any `forbid` matches, the answer is deny. Otherwise, the answer is allow only if a `permit` matches.

The `has` checks are needed because of how Cedar handles errors. A policy can raise an error, e.g., when it reads an attribute that doesn't exist, and Cedar then skips the policy instead of treating it as a deny. Skipping a `permit` is harmless, but skipping a `forbid` removes the protection without any message. With the `has` checks, a missing account id makes the forbid match, and no error occurs.

---

## Evaluating a request

A route declares the action that it needs, e.g., `ViewPhoto` on a photo. Before the server calls Cedar, it loads only the part of the graph that can affect the decision.

1. The caller's groups.
2. The ancestors of the resource, e.g., the albums of a photo.
3. The unexpired grants on the resource or its ancestors that belong to the caller, the caller's groups, or the account.

The grants table can be large, but a check loads only a few rows from it. The server turns the rows into the request, the entities, and the policies that Cedar takes as input. The inputs for alice are the following.

```
request    User::"alice", Action::"ViewPhoto", Photo::"VacationPhoto94.jpg"

entities   User::"alice"                 in Group::"janeFriends", Account::"photoclub"
           Group::"janeFriends"          in Account::"photoclub"
           Photo::"VacationPhoto94.jpg"  in Album::"janeTrips"
           Album::"janeTrips"            in Account::"photoclub"

policies   viewer template linked to (Group::"janeFriends", Album::"janeTrips")
           built-in policies
```
{: .no-copy}

Cedar then evaluates each policy against the request. The tenant boundary doesn't match, because alice and the photo are in the same account. The linked viewer policy matches on the principal, the action, and the resource. Alice is in `janeFriends`, and `ViewPhoto` is in the viewer action list. The photo is in `janeTrips`.

No forbid matched and a permit matched, so the decision is allow. Cedar also returns the policies that determined the decision, and any errors. If you log the policies, you can see which rule denied a request, e.g., the tenant boundary.

---

## Listing what someone can see

A list page needs a different method, because a check answers a question about one resource and the page can't run the check on every photo in the account. A list starts from the caller's grants instead.

1. Load each unexpired grant that the caller has, directly or through a group or the account.
2. Expand each grant down the hierarchy, so a grant on an album includes the photos in it.
3. If more than one path leads to the same photo, keep the highest role.

For example, if the caller has a direct `viewer` grant on a photo and the photo is in an album that the caller can edit, the result for the photo is `editor`. Each id comes back with its role, so the grid can show or hide the edit and share buttons of each photo without a second request.

---

## Sharing

A share creates or updates a grant, which consists of a principal, a resource, a role, and an optional expiry. The principal can be a user, a group, or all the users in the account. The code skips expired grants when it loads grants, so temporary access ends without a cleanup job.

A share is also an action, so it goes through the same check as every other action. Apps usually permit sharing for editors, and sometimes only for admins, and viewers can't share. The following rules are also common.

- You can't give someone a role higher than your own.
- A resource always keeps at least one admin, so the last admin can't be removed or given a lower role.

---

## Adding a new resource type

Adding a resource type takes a few changes and no new policies. For example, to add slideshows, which are in albums, you do the following.

1. Add `entity Slideshow in [Album]` to the schema, with an `accountId` like every other entity.
2. Declare its actions and add each action to the role that permits it, e.g., `ViewSlideshow` to `viewer` and `EditSlideshow` to `editor`. Creating a slideshow is an action on the album, like adding a photo.
3. Make sure that the code that loads the ancestors of a resource can find the album of a slideshow.
4. Protect the slideshow routes with the actions that they need.
5. When a slideshow is created, write the creator's `admin` grant and the link to the album.

Slideshows inherit access through `in`, as photos do.

---

## References

1. [Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/pub48190/)
2. [Cedar policy language](https://www.cedarpolicy.com/)
3. [Cedar authorization: how decisions are made](https://docs.cedarpolicy.com/auth/authorization.html)
4. [OpenFGA](https://openfga.dev)
5. [SpiceDB](https://authzed.com/spicedb)
6. [AWS Verified Permissions](https://aws.amazon.com/verified-permissions/)
