#!/bin/sh
set -eu
dist_dir=${1:?Usage: publish.sh DIST_DIR RELEASE_ID SITE_CONFIG}
release_id=${2:?Missing release ID}
site_config=${3:?Missing site config}
case "$release_id" in *[!a-zA-Z0-9_-]*|'') echo 'Invalid release ID' >&2; exit 1;; esac
test -s "$dist_dir/index.html"
cd "$HOME/wiki/deploy/oci"
container_id=$(docker compose ps -q caddy)
test -n "$container_id"
docker exec "$container_id" mkdir -p /data/sites /data/codecafe/assets "/data/codecafe/releases/$release_id"
docker cp "$dist_dir/." "$container_id:/data/codecafe/releases/$release_id/"
docker cp "$dist_dir/assets/." "$container_id:/data/codecafe/assets/"
previous=$(docker exec "$container_id" sh -c 'readlink /data/codecafe/current || true')
docker exec "$container_id" sh -c 'if [ -f /data/sites/codecafe.caddy ]; then cp /data/sites/codecafe.caddy "/data/codecafe/config-before-$1"; fi' sh "$release_id"
docker cp "$site_config" "$container_id:/data/sites/codecafe.caddy"
docker cp Caddyfile "$container_id:/tmp/codecafe-base-Caddyfile"
restore_config() {
    docker exec "$container_id" sh -c 'if [ -f "/data/codecafe/config-before-$1" ]; then cp "/data/codecafe/config-before-$1" /data/sites/codecafe.caddy; else rm -f /data/sites/codecafe.caddy; fi' sh "$release_id"
}
if ! docker exec "$container_id" caddy validate --config /tmp/codecafe-base-Caddyfile --adapter caddyfile; then
    restore_config
    exit 1
fi
docker exec "$container_id" sh -c 'ln -s "releases/$1" /data/codecafe/next; mv -Tf /data/codecafe/next /data/codecafe/current' sh "$release_id"
if ! docker exec "$container_id" caddy reload --config /tmp/codecafe-base-Caddyfile --adapter caddyfile; then
    restore_config
    if [ -n "$previous" ]; then
        docker exec "$container_id" sh -c 'ln -s "$1" /data/codecafe/rollback; mv -Tf /data/codecafe/rollback /data/codecafe/current' sh "$previous"
    fi
    exit 1
fi
printf 'Published CodeCafe frontend release %s\n' "$release_id"
