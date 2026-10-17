#!/bin/bash
# Test deploy: same Pages project, branch "next" -> preview URL https://next.card-binder-5zt.pages.dev
# The live site (production branch main) is NOT touched. Use deploy.sh only after Scott approves.
set -e; cd "$(dirname "$0")"
export CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN:-$(cat /workspace/.secrets/cloudflare_token)} CLOUDFLARE_ACCOUNT_ID=43bad9192aef8a2f9943eb61252d663c
rm -rf dist-next && cp -r public dist-next
V=next-$(git rev-parse --short HEAD)$(git diff --quiet || echo d)
sed -i "s/const V = 'cb-v1';/const V = 'cb-$V';/" dist-next/sw.js
sed -i "s#js/app.js\"#js/app.js?v=$V\"#" dist-next/index.html
npx -y wrangler@3 pages deploy dist-next --project-name card-binder --branch next --commit-dirty=true
