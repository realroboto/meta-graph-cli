---
name: fbg
description: Call the Meta Graph API via the fbg CLI for the gap the official meta CLI leaves: Business Manager, system users, asset assignment, ad accounts, custom audiences, lookalikes, Pages/Instagram, webhooks
---

# fbg — Meta Graph API passthrough

`fbg` is a passthrough CLI: the path **is** the URL, so any Graph route works. This skill is the **gap map** — the Business-side routes the official `meta` CLI can't reach, each grounded in Meta's own reference. Ads day-to-day (campaigns, ad sets, ads, creatives, insights, catalogs, pixels) is the `meta` CLI's job, not here.

## Shape

```
fbg <VERB> <path> [--k=v ...] [--paginate] [--api-version=vNN.0]
```

- `GET` → flags are query params. Any other verb → flags are a form body.
- **Error contract:** success is JSON on stdout, exit 0. A Graph `error` body (even under HTTP 200) or status ≥400 exits non-zero with the error on stderr. Trust the exit code.
- Auth: `export META_ACCESS_TOKEN=<system-user-token>` or `fbg auth login`. Run `fbg --help` for the full flag list.
- Read-only recon first: a bare token walks the graph — `fbg GET /me`, `/me/businesses`, `/me/accounts`, `/me/adaccounts`.

## Gap map

Every write path here creates real, billable-adjacent state. Confirm the target id before a POST/DELETE. Required POST params are named per row from the official reference.

### Business Manager

| Want | Command |
|---|---|
| My businesses | `fbg GET /me/businesses --fields=id,name` |
| Owned ad accounts | `fbg GET /<biz-id>/owned_ad_accounts --paginate` |
| Owned pages | `fbg GET /<biz-id>/owned_pages --paginate` |
| Create ad account | `fbg POST /<biz-id>/adaccount --name=X --currency=USD --timezone_id=1 --end_advertiser=<id> --media_agency=<id> --partner=<id>` |

Source: [business](https://developers.facebook.com/docs/marketing-api/reference/business/) · [business/adaccount](https://developers.facebook.com/docs/marketing-api/reference/business/adaccount/)

### System users & business users

| Want | Command |
|---|---|
| List system users | `fbg GET /<biz-id>/system_users` |
| Create system user | `fbg POST /<biz-id>/system_users --name=X --role=ADMIN` |
| List business users | `fbg GET /<biz-id>/business_users` |
| Invite business user | `fbg POST /<biz-id>/business_users --email=<addr> --role=ADMIN` |

Source: [system_users](https://developers.facebook.com/docs/marketing-api/reference/business/system_users/) · [business_users](https://developers.facebook.com/docs/marketing-api/reference/business/business_users/)

### Asset assignment

`tasks` is an enum array, e.g. `MANAGE`, `ADVERTISE`, `ANALYZE`.

| Want | Command |
|---|---|
| Who has this ad account | `fbg GET /<act-or-page-id>/assigned_users` |
| Assign user to ad account | `fbg POST /act_<id>/assigned_users --user=<uid> --tasks=["MANAGE"]` |
| Unassign user | `fbg DELETE /act_<id>/assigned_users --user=<uid>` |
| Assign user to page | `fbg POST /<page-id>/assigned_users --user=<uid> --tasks=["MANAGE"]` |

Source: [ad-account/assigned_users](https://developers.facebook.com/docs/marketing-api/reference/ad-account/assigned_users/) · [page/assigned_users](https://developers.facebook.com/docs/graph-api/reference/page/assigned_users/)

### Custom audiences & lookalikes

Lookalike is not a separate node — it is `subtype=LOOKALIKE` on the customaudiences edge.

| Want | Command |
|---|---|
| List audiences | `fbg GET /act_<id>/customaudiences --fields=id,name,subtype` |
| Create custom audience | `fbg POST /act_<id>/customaudiences --name=X --subtype=CUSTOM` |
| Create lookalike | `fbg POST /act_<id>/customaudiences --name=X --subtype=LOOKALIKE --origin_audience_id=<id> --lookalike_spec=<json>` |
| Delete audience | `fbg DELETE /<audience-id>` |

Source: [custom-audience](https://developers.facebook.com/docs/marketing-api/reference/custom-audience/) · [lookalikes guide](https://developers.facebook.com/docs/marketing-api/audiences/guides/lookalike-audiences/)

### Pages & Instagram

| Want | Command |
|---|---|
| My pages | `fbg GET /me/accounts --fields=id,name,access_token` |
| Connected IG account | `fbg GET /<page-id>?fields=instagram_business_account` |
| IG media | `fbg GET /<ig-user-id>/media --paginate` |

Source: [page](https://developers.facebook.com/docs/graph-api/reference/page/) · [ig-user](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/)

### Activity logs

| Want | Command |
|---|---|
| Ad account activity | `fbg GET /act_<id>/activities --paginate` |

Source: [ad-account/activities](https://developers.facebook.com/docs/marketing-api/reference/ad-account/activities/) — the log lives on the ad account; there is no `/business/activities` edge.

### Webhooks

| Want | Command |
|---|---|
| List app subscriptions | `fbg GET /<app-id>/subscriptions` |
| Subscribe app | `fbg POST /<app-id>/subscriptions --object=page --callback_url=<https-url> --fields=feed --verify_token=<tok>` |
| Unsubscribe app | `fbg DELETE /<app-id>/subscriptions --object=page` |
| Subscribe page to app | `fbg POST /<page-id>/subscribed_apps --subscribed_fields=["feed"]` |

Source: [app/subscriptions](https://developers.facebook.com/docs/graph-api/reference/app/subscriptions/) · [page/subscribed_apps](https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/)

## Notes

- Two API tracks share one version number on separate changelogs: `/act_<id>/…` is Marketing API, the rest is Graph API. `fbg` defaults to a single version; override per call with `--api-version=vNN.0` only if a Marketing path diverges.
- This map is curated, not exhaustive — `fbg` reaches any route. For a field or edge not listed, read the linked reference and build the path directly; the passthrough already supports it.
- Param shapes (`tasks`, `lookalike_spec`) come from the reference pages above — check the current page when a call is rejected, since Meta versions these.
