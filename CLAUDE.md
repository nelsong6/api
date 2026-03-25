# api

Shared always-on Express backend consolidating all app backends into a single Azure Container App at `api.romaine.life`. Eliminates 30-second cold starts from per-app Container Apps scaling to zero (~$19/month for always-on 0.25 vCPU / 0.5 Gi).

## Dependency Tree

```
infra-bootstrap          Creates shared infra + per-app OIDC credentials & GitHub repos
       │
       ▼
  app repos              kill-me, plant-agent, my-homepage
       │                 Each publishes a @nelsong6/*-routes npm package
       │                 to GitHub Packages via publish-routes.yml
       │
       ▼  (repository_dispatch: "dependency-updated")
      api                Installs route packages, builds Docker image, deploys
```

The API must live in its own repo to avoid a circular dependency: infra-bootstrap creates the app repos, but the API needs their published npm packages to build. If the API were inside infra-bootstrap, it would need to rebuild itself in response to app changes.

## Architecture

```text
server.js              Express gateway — mounts route packages under path prefixes
auth/                  Microsoft OAuth (shared across kill-me and plant-agent)
middleware/            JWT verification (requireAuth) and admin guard (requireAdmin)
startup/               App Configuration + Key Vault config loader
tofu/                  OpenTofu infra (Container App, DNS, certs, JWT secret)
.github/workflows/     CI/CD: build.yml → deploy.yml (chained), tofu.yml (infra)
```

### Route mounting

Each app's routes are an npm package installed at build time:

| Prefix | Package | Database | Notes |
|--------|---------|----------|-------|
| `/workout` | `@nelsong6/kill-me-routes` | WorkoutTrackerDB / workouts | Shared Microsoft auth mounted here too |
| `/plant` | `@nelsong6/plant-agent-routes` | PlantAgentDB / plants, events, analyses, chats, push-subscriptions | Shared Microsoft auth mounted here too |
| `/homepage` | `@nelsong6/my-homepage-routes` | HomepageDB / userdata | Self-contained sub-app with own cookie-parser, passport, JWT secret |
| `/auth` | Local `auth/microsoft-routes.js` | WorkoutTrackerDB / workouts (account docs) | Microsoft OIDC → self-signed JWT |

### Auth model

Two separate auth systems coexist:

1. **Microsoft OAuth** (kill-me, plant-agent) — shared `microsoft-routes.js` at `/auth/microsoft/login`. Verifies Microsoft ID tokens via JWKS, issues 7-day JWTs signed with `api-jwt-signing-secret`. Admin: `nelson-devops-project@outlook.com`, all others: viewer.

2. **Multi-provider OAuth** (my-homepage) — self-contained passport.js setup inside the homepage routes package. Supports GitHub, Google, Microsoft, Apple (via Auth0). Uses its own JWT secret (`my-homepage-jwt-signing-secret`). Callback URLs are domain-agnostic via `req.get('host')`.

### Config loading

`startup/appConfig.js` fetches all config at startup using system-assigned managed identity:

- **Azure App Configuration** — Cosmos endpoint, OAuth client IDs, per-app settings (storage endpoints, Auth0 config, SWA hostname)
- **Key Vault** — JWT signing secrets, OAuth client secrets, Anthropic API key, VAPID keys
- Key Vault references in App Config are resolved automatically via `resolveKvReference()`

### Infrastructure (tofu/)

Resources created in the `infra` resource group:
- Container App (`shared-api`) — always-on, single revision, system-assigned identity
- DNS records (`api.romaine.life` CNAME + TXT verification)
- Managed certificate binding
- JWT signing secret in Key Vault (`api-jwt-signing-secret`)
- Role assignments: Cosmos DB Data Contributor, App Config Data Reader, Key Vault Secrets User

CORS allows: `workout.romaine.life`, `plants.romaine.life`, `homepage.romaine.life`, SWA default hostname (dynamic from App Config), and localhost dev ports.

### CI/CD

1. **build.yml** — triggers on push to main, PRs, or `repository_dispatch` ("dependency-updated" from app repos). Runs tests, builds and pushes Docker image to GHCR.
2. **deploy.yml** — triggers after successful build. Updates Container App image tag, binds custom domain if needed.
3. **tofu.yml** — triggers on changes to `tofu/`. Plans and applies infrastructure.

The Dockerfile authenticates to GitHub Packages via `NPM_TOKEN` build arg to install `@nelsong6/*` scoped packages.

## Change Log

### 2026-03-23

- Deployed with all three app backends consolidated: kill-me (`/workout`), plant-agent (`/plant`), my-homepage (`/homepage`). All per-app Container Apps have been decommissioned.

### 2026-03-22

- Initial creation with kill-me and plant-agent routes. Container App provisioned as always-on (`min_replicas=1`).
