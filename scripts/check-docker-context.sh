#!/usr/bin/env bash
# Build from a clean archive and inject only synthetic sentinels in that archive.
# No existing checkout/host file is read, overwritten, or removed by fixtures.
set -euo pipefail
app="${1:?Usage: check-docker-context.sh macros|workouts}"
case "$app" in macros|workouts) ;; *) echo 'Unknown app' >&2; exit 1 ;; esac
repo_root="$(git rev-parse --show-toplevel)"
revision="$(git rev-parse HEAD)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/health-docker-context.XXXXXX")"
context="$scratch/context"
container_id=''
cleanup() {
  if [ -n "$container_id" ]; then
    docker rm "$container_id" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
mkdir "$context"
git -C "$repo_root" archive HEAD | tar -x -C "$context"
python3 - "$context" "$app" "$scratch/paths" <<'PY'
import sys
from pathlib import Path
context, app, manifest = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
paths = ['.env', '.env.synthetic-ci', 'key.pem', 'private.key',
         '.ssh/context-sentinel', '.aws/context-sentinel',
         'public/.env.context-sentinel', 'public/context-sentinel.pem',
         'public/context-sentinel.key']
nested = 'src/context-privacy-fixture' if app == 'macros' else 'backend/context-privacy-fixture'
paths += [nested + '/' + path for path in ['.env', '.env.nested', 'key.pem', 'private.key',
                                         '.ssh/context-sentinel', '.aws/context-sentinel']]
if app == 'macros':
    paths += ['data/context-sentinel', 'backups/context-sentinel']
for relative in paths:
    destination = context / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    # A future tracked file collision fails rather than overwriting its content.
    with destination.open('x') as handle:
        handle.write('SYNTHETIC_DOCKER_CONTEXT_SENTINEL=not-a-real-credential\n')
manifest.write_text('\n'.join(paths) + '\n')
PY
sentinels=()
while IFS= read -r relative; do sentinels+=("$relative"); done < "$scratch/paths"
assert_node_image() {
  docker run --rm --network none --entrypoint node "$1" -e '
    const fs = require("node:fs");
    const present = process.argv.slice(1).filter(path => fs.existsSync("/app/" + path));
    if (present.length) throw new Error("Synthetic private paths entered the image: " + present.join(", "));
    console.log("All synthetic private paths are absent from image");
  ' -- "${sentinels[@]}"
}
image="$app-context-ci:$revision"
if [ "$app" = macros ]; then
  public_ca_hash="$(python3 - "$context/certs/us-east-2-rds-bundle.pem" <<'PYCA'
import hashlib, re, subprocess, sys
from pathlib import Path
raw = Path(sys.argv[1]).read_bytes()
text = raw.decode('ascii')
pattern = r'-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----'
certificates = re.findall(pattern, text)
if not certificates or re.sub(pattern, '', text).strip():
    raise SystemExit('The allowlisted CA bundle must contain only public certificates')
for certificate in certificates:
    checked = subprocess.run(['openssl', 'x509', '-noout'], input=certificate, text=True,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if checked.returncode:
        raise SystemExit('The allowlisted public CA bundle contains an invalid certificate')
print(hashlib.sha256(raw).hexdigest())
PYCA
)"
  docker build --tag "$image" "$context"
  assert_node_image "$image"
  docker run --rm --network none --entrypoint node "$image" -e '
    const fs = require("node:fs"), crypto = require("node:crypto");
    const actual = crypto.createHash("sha256").update(fs.readFileSync("/app/certs/us-east-2-rds-bundle.pem")).digest("hex");
    if (actual !== process.argv[1]) throw new Error("Reviewed public CA bundle changed or is absent");
    console.log("Reviewed public CA bundle preserved exactly");
  ' -- "$public_ca_hash"
else
  docker build --target build-frontend --tag "$image-frontend-source" "$context"
  assert_node_image "$image-frontend-source"
  docker build --target backend --tag "$image-backend" "$context"
  assert_node_image "$image-backend"
  # Reuse only this isolated build's public assets for the actual production stage.
  container_id="$(docker create "$image-frontend-source")"
  mkdir "$context/dist"
  docker cp "$container_id:/app/dist/." "$context/dist/"
  docker rm "$container_id" >/dev/null
  container_id=''
  docker build --target frontend-prebuilt --tag "$image" "$context"
  docker run --rm --network none --entrypoint sh "$image" -c '
    for relative in .env.context-sentinel context-sentinel.pem context-sentinel.key; do
      if [ -e "/usr/share/nginx/html/$relative" ]; then
        echo "Synthetic private public-asset path entered image: $relative" >&2
        exit 1
      fi
    done
    echo "Synthetic private paths are absent from production frontend assets"
  '
fi
