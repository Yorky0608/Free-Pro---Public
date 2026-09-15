# Rocket Slider (Vite Web App)

A small mockup app: a slider from **0** to **140** that moves a rocket across the track.

## Requirements

- Node.js (LTS recommended)
- A modern browser

## Install

Important: run all `npm` commands from the `vite-project/` folder (the folder that contains `package.json`).

```bash
cd vite-project
```

Then install dependencies:

```bash
npm install
```

## Run as a website (browser)

Start the Vite dev server:

```bash
npm run dev
```

If you are in the parent folder (one level above `vite-project/`), you can also run:

```bash
npm --prefix vite-project run dev
```

Then open the URL shown in the terminal (usually `http://localhost:5173/`).

## Run as a mobile app

The app now ships with a Capacitor wrapper, so the same Vite codebase can be built as a native Android app.

Install dependencies first:

```bash
cd vite-project
npm install
```

Build and sync the web bundle into the native projects:

```bash
npm run mobile:build
```

Open the Android project in Android Studio:

```bash
npm run mobile:android
```

Notes:

- The native Android project lives in `android/`.
- After frontend changes, rerun `npm run mobile:build` before testing in the emulator/device.
- On Windows, Android is the supported native target in this workspace. iOS would need to be added from a macOS machine later.

### Web login + sync (optional)

The browser build now supports the same email/password login UI. In web mode, it authenticates directly against the cloud API (and, when logged in, will sync savings + goal to the API).

Notes:

- In dev (`npm run dev`), the app uses a Vite proxy: requests go to `/api/...` and Vite forwards them to your real API (helps avoid CORS while developing locally).
- In production (including GitHub Pages), your API must enable CORS for your site origin or the browser will fail with a network error like "Failed to fetch".

To point the web build at a different API base URL, set:

- `VITE_API_BASE_URL` (example: `https://your-api.example.com`)

## Cloud API (AWS) notes

If your API Gateway routes point at a Lambda, that Lambda must have the required environment variables set.
If they are missing, endpoints like `POST /auth/login` will return `500 {"message":"Internal Server Error"}`.

Required Lambda env vars:

- `USERS_TABLE` — DynamoDB table name for users
- `SAVINGS_TABLE` — DynamoDB table name for savings/month log
- `LEDGER_TABLE` — DynamoDB table name for ledger entries
- `JWT_SECRET` — secret used to sign/verify JWTs (keep this stable, or existing tokens become invalid)
- `INSTRUCTOR_EMAILS` — optional comma-separated emails that should default to instructor role
- `SUPER_INSTRUCTOR_EMAILS` — optional comma-separated emails that should default to super-instructor role

If you want account names to sync through AWS as well, update your auth Lambda and `USERS_TABLE` items so:

- `POST /auth/register` accepts `name` alongside `email` and `password`
- the user item stores a `name` attribute in DynamoDB
- `POST /auth/register` returns `name` in its JSON response
- `POST /auth/login` also returns `name` so the browser app can restore it from cloud auth

Recommended shape for a user item:

```json
{
  "userId": "uuid-or-cognito-sub",
  "email": "person@example.com",
  "name": "Person Name",
  "passwordHash": "...",
  "createdAtMs": 1714090000000
}
```

Minimum backend checklist:

- extend request validation to allow an optional `name` string
- write `name` into DynamoDB on registration
- include `name` in the JWT payload or fetch it during login response generation
- keep CORS enabled for your app origin if the browser build calls API Gateway directly

For the in-app name editor added in the dashboard, expose one more authenticated route:

- `POST /profile/name` with body `{ "name": "New Name" }`
- read the user from the bearer token
- update the `name` attribute in `USERS_TABLE`
- return `{ "name": "New Name" }`

Example Lambda handler shape:

```js
if (event.httpMethod === "POST" && event.path === "/profile/name") {
  const token = event.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const claims = verifyJwt(token);
  const body = JSON.parse(event.body || "{}");
  const name = String(body.name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);

  await dynamo
    .update({
      TableName: process.env.USERS_TABLE,
      Key: { userId: claims.userId },
      UpdateExpression: "SET #name = :name",
      ExpressionAttributeNames: { "#name": "name" },
      ExpressionAttributeValues: { ":name": name || null },
    })
    .promise();

  return json(200, { name });
}
```

Quick verification (should return `401` for bad creds, not `500`):

```bash
node -e "fetch('https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'debug@example.com',password:'notreal'})}).then(async r=>{console.log('status',r.status); console.log('body', (await r.text()).slice(0,200));}).catch(e=>{console.error(e); process.exit(1);});"
```

## Active AWS Routes

The current frontend expects these authenticated API routes in addition to auth, savings sync, and ledger sync:

- `GET /profile/settings`
- `POST /profile/settings`
- `GET /profile/account`
- `GET /instructor/dashboard`
- `POST /instructor/create-account`
- `POST /instructor/set-role`
- `POST /instructor/assign-students`
- `POST /instructor/notifications`

Notes:

- the instructor routes are handled by the same Lambda and existing DynamoDB tables
- these are additional API Gateway routes, not separate AWS services
- `GET /instructor/dashboard` supports a super-instructor selecting an instructor roster with `?instructorEmail=`

## Build

Build the web assets:

```bash
npm run build
```

This outputs a production build into the `dist/` folder.

## Project Structure

- `index.html` – app entry HTML
- `src/main.js` – UI + slider logic
- `src/style.css` – theme + styles

Savings, journals, habits, settings, and ledger data are stored in browser storage for the current prototype flow.

The current app does not read from a project SQLite file. If you see a local `.sqlite3` file in the repo, treat it as legacy/dev-only data rather than the active source of truth for the UI.

## Python DB Schema Init (legacy utility)

There is also a Python helper script to create the same tables in a SQL database:

```bash
python scripts/init_db.py
```

It uses `DATABASE_URL` (defaults to SQLite). For other SQL engines later, point `DATABASE_URL` at your rollout database.

This helper is not used by the current browser app at runtime.

Dependencies for that script:

- `sqlalchemy`
