# Fieldnote Tenant Platform

A single React application with tenant-aware workspaces, an Express API, and SQLite persistence. Organization branding and role-specific navigation are configuration data, so shared product changes ship once rather than being copied into tenant-specific frontends.

## Run locally

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). The API runs on port `3001`; Vite proxies `/api` requests to it. The SQLite database is created at `backend/tenant-platform.sqlite3`, and tenant asset folders are created under `app/<folder-name>`.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Platform admin | `admin@atlas.test` | `Platform123!` |
| Organization admin | `admin@cedar.test` | `Organization123!` |
| Organization member | `member@cedar.test` | `Member123!` |
| Harbor House admin | `admin@harbor.test` | `Organization123!` |
| Harbor House member | `member@harbor.test` | `Member123!` |

The seeded accounts are for local development only. Password hashes are stored in SQLite; passwords are never returned by the API.

## Tenant and role model

- `platform_admin` manages organizations and the shared menu catalog, and can open an organization workspace.
- `org_admin` customizes that organization’s name, welcome line, colors, logo URL, and which menu entries are visible to each organization role.
- `org_user` sees the same shared workspace with the organization branding and only the navigation allowed for members.
- Organization folder names are lowercase slugs stored in SQLite and validated before the server creates `app/<folder-name>`.
- Every organization API route verifies the signed-in user’s organization, except platform-admin routes.

The current menu destinations are workspace UI placeholders, not separate business modules. Tenant folders are reserved for organization-specific static assets; frontend code stays shared.

## Production settings

Set `NODE_ENV=production` and provide a long, random `JWT_SECRET` before starting the API. For example, generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Use `npm run build` to build the frontend. The local demo fallback secret must not be used in production.

## Useful commands

- `npm run dev` starts the API and Vite together.
- `npm run dev:api` starts only the API.
- `npm run build` creates the production frontend bundle.
- `npm run lint` runs Oxlint.
- `npm start` starts the API.