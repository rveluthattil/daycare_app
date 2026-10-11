# Fieldnote Tenant Platform

Fieldnote is a multi-tenant application starter built with React, Express, and SQLite. It uses one shared frontend for every organization. Tenant identity, branding, and navigation are stored as data, so shared product updates do not need to be copied between organization-specific frontends.

## Features

- Platform administrator dashboard to view and enter organization workspaces.
- Organization creation with a validated folder slug and first organization administrator account.
- Shared menu catalog managed by the platform administrator.
- Per-organization menu enablement and visibility controls for organization admins and members.
- Organization-level name, welcome line, primary/accent colors, and optional logo URL.
- Password hashing, signed HTTP-only session cookies, and server-side organization access checks.
- SQLite database initialization and demo data seeding on API startup.

## Requirements

- Node.js 20 or newer
- npm

`better-sqlite3` includes a native module. If npm cannot install its prebuilt binary for your platform, a working C/C++ build toolchain may be required.

## Run locally

From this directory:

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal, normally [http://localhost:5173](http://localhost:5173). The Express API listens on port `3001`, and Vite proxies `/api` requests to it.

The API creates `backend/tenant-platform.sqlite3` automatically. It also creates a directory under `app/<folder-name>` for each organization. These directories are intended for tenant-specific static assets; application code remains shared.

## Demo accounts

| Role | Organization | Email | Password |
| --- | --- | --- | --- |
| Platform admin | Platform | `admin@atlas.test` | `Platform123!` |
| Organization admin | Cedar & Stone | `admin@cedar.test` | `Organization123!` |
| Organization member | Cedar & Stone | `member@cedar.test` | `Member123!` |
| Organization admin | Harbor House | `admin@harbor.test` | `Organization123!` |
| Organization member | Harbor House | `member@harbor.test` | `Member123!` |

These accounts are for local development only. Passwords are stored as bcrypt hashes and are not returned by the API. Do not use the demo credentials in a deployed environment.

## Roles and tenant behavior

| Role | Access |
| --- | --- |
| `platform_admin` | Views the organization directory, opens organization workspaces, and manages the shared menu catalog. |
| `org_admin` | Uses their organization workspace and manages its branding and role-specific navigation. |
| `org_user` | Uses their organization workspace and sees only navigation enabled for members. |

Organization folder names are lowercase hyphenated slugs stored in SQLite. The API validates the slug before creating the folder. Organization-scoped API requests are checked against the signed-in user’s organization; organization users cannot read another tenant’s records or update organization settings.

## Project layout

```text
backend/
	server.js                 Express API, SQLite schema, seed data, auth, and routes
	tenant-platform.sqlite3   Generated local database (ignored by Git)
app/
	cedar-stone/              Cedar & Stone tenant assets
	harbor-house/             Harbor House tenant assets
src/
	App.jsx                   Login, platform dashboard, workspace, and settings
	App.css                   Application layout and responsive styles
	index.css                 Global typography and design tokens
public/                     Static public assets and app icon
```

## Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the API and Vite frontend together. |
| `npm run dev:api` | Starts only the API with Node watch mode. |
| `npm run dev:web` | Starts only the Vite frontend. |
| `npm run build` | Creates the production frontend bundle in `dist/`. |
| `npm run preview` | Serves the production frontend bundle locally. |
| `npm run lint` | Runs Oxlint. |
| `npm start` | Starts the API only. |

## Configuration and deployment

Copy `.env.example` to `.env` for local configuration. Supported variables include:

```dotenv
PORT=3001
JWT_SECRET=replace-with-a-long-random-secret
```

In production, set `NODE_ENV=production` and provide a unique, long random `JWT_SECRET`. For example:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Build the frontend with `npm run build`. `npm start` serves only the API; configure your production web server to serve the `dist/` frontend and proxy `/api` to the API. Use HTTPS so the session cookie is secure. Back up the SQLite database and keep secrets and database files out of source control.

## Current scope

Menu entries currently navigate within the shared sample workspace UI; full project, document, reporting, and people-management modules are not implemented. Organization creation provisions its first admin, but user invitations and ongoing account administration are not implemented yet. The optional logo is currently configured by URL; file upload is not implemented. SQLite is used for this local starter and may need a managed database for multi-instance production deployments.