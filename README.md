# Event Judging Tool

A live online judging tool for 9 judges, 12 finalists, and 5 questions per finalist.

## Start locally

```powershell
node server.js
```

Open:

- Admin setup: `http://localhost:8787`
- Big screen: `http://localhost:8787/results.html`
- Judge 1: `http://localhost:8787/judge.html?judge=1`

## Access

- Default admin PIN: `2468`
- Default judge PINs: Judge 1 = `1001`, Judge 2 = `1002`, through Judge 9 = `1009`
- Change judge names and judge PINs on the admin setup page.
- For online hosting, set an `ADMIN_PIN` environment variable to a private PIN.

## Serious event checklist

1. Deploy the folder to a Node hosting service.
2. Set `ADMIN_PIN` to a private value.
3. Use a host with persistent storage so `scores.json` survives restarts.
4. Change all judge PINs before sharing links.
5. Test one judge link and the big-screen results link before the event starts.
6. Use **Export scores** during or after the event to download a CSV backup.

## Deployment notes

This app has no external package dependencies. Start command:

```bash
npm start
```

The app uses the hosting provider's `PORT` environment variable automatically.

Scores are stored in `scores.json` next to `server.js`. On Render, Fly.io, Railway, or a VPS, use a persistent disk/volume for this folder. If the host has no persistent storage, scores may disappear after a restart.
