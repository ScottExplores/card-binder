#!/bin/bash
# Deploy public/ to Cloudflare Pages (project card-binder). Needs CLOUDFLARE_API_TOKEN (read from /workspace/.secrets/cloudflare_token if unset).
set -e; cd "$(dirname "$0")"
export CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-$(cat /workspace/.secrets/cloudflare_token)} CLOUDFLARE_ACCOUNT_ID=43bad9192aef8a2f9943eb61252d663c
rm -rf dist && cp -r public dist
V=$(git rev-parse --short HEAD)$(git diff --quiet || echo d)
sed -i "s/const V = 'cb-v1';/const V = 'cb-$V';/" dist/sw.js
sed -i "s#js/app.js\"#js/app.js?v=$V\"#" dist/index.html
npx -y wrangler@3 pages deploy dist --project-name card-binder --branch main --commit-dirty=true
