# Forge relay server

A small Node WebSocket relay used by the `ws` transport (`?net=ws`). It owns
rooms, assigns peer ids, elects the host (first to join; longest-connected
member on host loss) and forwards messages to one peer or the whole room.
Game state never lives here: the host's browser is authoritative, the server
is a dumb relay. It can also serve the built game (`dist/`) so a single
process hosts everything.

You only need it when the default peer-to-peer transport (`?net=peer`,
WebRTC through the public PeerJS signalling cloud) cannot connect players,
typically strict corporate NATs, or when you want a fixed address.

## Run

```sh
npm run build              # produces dist/ (optional; relay works without it)
cd server && npm install   # installs `ws` (the only dependency)
cd .. && npm run serve     # node server/index.js
```

Open `http://localhost:8080/play.html?project=<id>&room=ABC&net=ws`. When the
page is served by this process the transport connects to `ws://<host>/ws`
automatically; from another origin (GitHub Pages, Vite dev server) pass
`&server=wss://your-host/ws`.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP + WebSocket port |
| `HOST` | `0.0.0.0` | Bind address |
| `WS_PATH` | `/ws` | WebSocket upgrade path |
| `STATIC` | `../dist` | Directory served over HTTP; set empty (`STATIC=`) for relay only |
| `MAX_PLAYERS` | `16` | Room capacity |
| `ROOM_IDLE_MS` | `60000` | Delete empty rooms after this long |
| `HEARTBEAT_MS` | `15000` | WebSocket ping interval (dead sockets are dropped after one missed pong) |
| `MAX_FRAME` | `262144` | Max message size in bytes |
| `VERBOSE` | unset | `1` logs joins/leaves |

Endpoints: `GET /health` → `{ ok, rooms, peers }`, `GET /rooms` → room list.

## Protocol (client ↔ server)

Text frames are JSON, binary frames are relayed opaque bytes.

Client → server

| Message | Purpose |
| --- | --- |
| `{ t:'join', room, name, wantHost }` | Join/create a room. Reply: `welcome`. |
| `{ t:'send', to: <peerId>\|'all', d }` | Relay JSON `d` to one peer or everyone else. |
| `[0x01][u8 toLen][to utf8][payload]` | Relay binary; `toLen = 0` means broadcast. |
| `{ t:'ping', ts }` | RTT probe. Reply: `{ t:'pong', ts }`. |
| `{ t:'leave' }` | Leave the room (closing the socket does the same). |

Server → client

| Message | Purpose |
| --- | --- |
| `{ t:'welcome', id, room, host, peers:[{id,name}] }` | Your id, the host and the roster. |
| `{ t:'peer-join', id, name }` / `{ t:'peer-leave', id }` | Roster changes. |
| `{ t:'host', id }` | Host migrated. |
| `{ t:'msg', from, d }` | Relayed JSON. |
| `[0x01][u8 fromLen][from utf8][payload]` | Relayed binary. |
| `{ t:'error', code, message }` | `bad-room`, `room-full`, `bad-json`, `unknown`. |

## Deploy

Any Node 18+ host works (Fly.io, Railway, Render, a VPS with systemd,
Cloud Run). Terminate TLS in front of it (the browser needs `wss://` when the
page is served over HTTPS) and forward WebSocket upgrades on `/ws`.

Docker (multi-stage: builds the game, then serves `dist/` + relay):

```sh
docker build -f server/Dockerfile -t forge-game .
docker run -p 8080:8080 forge-game
```

nginx snippet for a reverse proxy:

```nginx
location /ws {
  proxy_pass http://127.0.0.1:8080;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 3600s;
}
location / { proxy_pass http://127.0.0.1:8080; }
```

Static-only hosting (GitHub Pages) plus a relay elsewhere: build and publish
`dist/`, run the relay with `STATIC=` on your server, and share links with
`&net=ws&server=wss://relay.example.com/ws`.

## Self-hosting PeerJS signalling instead

The default `peer` transport uses the public PeerJS cloud. To self-host
signalling run `npx peer --port 9000 --path /peerjs` (package `peer`) and
pass `&server=wss://your-host:9000/peerjs` with `&net=peer`. WebRTC media
still flows peer-to-peer; add a TURN server through `PeerTransportOptions.iceServers`
for players behind symmetric NATs.
