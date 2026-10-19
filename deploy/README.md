# CodeCafe production hosting

Production runs on the existing OVH server shared with WikiRacing. Caddy serves the built frontend and proxies `/api/*` and `/ws/*` to the isolated CodeCafe Spring Boot service. Build the frontend with `VITE_BACKEND_URL=''` so API and SockJS requests use the page origin. The `api.codecafe.app` hostname remains available for older clients.

## Deployment

`Deploy CodeCafe` builds and publishes frontend changes automatically on main. Backend or Compose changes rebuild and restart only CodeCafe's API service. Manual runs publish the frontend by default; select `deploy_backend` to rebuild the backend too. The WikiRacing backend and personal website remain running.

GitHub requires the `VPS_SSH_KEY` secret and `VPS_HOST`, `VPS_USER`, `VPS_SSH_HOST_KEY` variables. The SSH host key is pinned. The obsolete EC2 deployment has been replaced; existing AWS secrets are not used by the new workflow.

The server source and Compose configuration live in `~/codecafe`. Run:

```sh
cd ~/codecafe
docker compose -p codecafe -f deploy/compose.yml build api
docker compose -p codecafe -f deploy/compose.yml up -d --wait --wait-timeout 120
```

The API and Redis expose no host ports. Caddy reaches the API through the external `oci_default` Docker network under `codecafe-api`. Redis is on CodeCafe's own network, uses a persistent append-only volume, and has a memory limit without silent eviction. API memory and CPU limits protect the other apps on this server.

Frontend releases live in Caddy's persistent data volume under `/data/codecafe`. `publish.sh` validates the complete shared configuration, retains hashed assets, switches the current release atomically, and gracefully reloads Caddy. The base Caddyfile imports `/data/sites/*.caddy`; this app owns `/data/sites/codecafe.caddy`.

DNS maps `codecafe.app` and `api.codecafe.app` to the server, with `www` aliasing the apex. Caddy manages HTTPS for all three names and redirects `www` to the apex.

## Recovery limits

The old API IP served an unrelated site's certificate and HTTP error page during recovery, and the original SSH host timed out. This deployment starts a new Redis store and new in-memory sessions; old collaboration sessions were not recovered. No old AWS resources were modified or deleted.

The original code-execution dependency at `https://emkc.org/api/v2/piston/execute` returned HTTP 401 with a notice that public access became whitelist-only on February 15, 2026. Editor, browser preview, and collaboration do not depend on that service. Server-side execution requires restored provider access or a separately provisioned runner.
