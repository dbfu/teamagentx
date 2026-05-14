#!/bin/sh
# 容器启动时用运行时环境变量重新生成 update.json，
# 覆盖镜像构建阶段烧入的版本，使 docker run -e 参数立即生效。
set -e

HTML_DIR=/usr/share/nginx/html
UPDATE_JSON="${HTML_DIR}/update.json"

VERSION="${VITE_APP_VERSION:-v1.2.0}"
RELEASE_VERSION=$(echo "$VERSION" | sed 's/^[vV]//')

MAC_URL="${VITE_DOWNLOAD_URL_MAC:-https://releases.teamagentx.com/${RELEASE_VERSION}/TeamAgentX-${RELEASE_VERSION}-mac.dmg}"
WIN_URL="${VITE_DOWNLOAD_URL_WIN:-https://releases.teamagentx.com/${RELEASE_VERSION}/TeamAgentX-${RELEASE_VERSION}-win.exe}"
NOTES="${VITE_APP_VERSION_NOTE:-${VITE_UPDATE_NOTES:-}}"

cat > "$UPDATE_JSON" <<EOF
{
  "version": "${VERSION}",
  "url": "${MAC_URL}",
  "macUrl": "${MAC_URL}",
  "winUrl": "${WIN_URL}",
  "downloads": {
    "mac": "${MAC_URL}",
    "win": "${WIN_URL}"
  },
  "notes": "${NOTES}"
}
EOF

echo "[entrypoint] update.json 已生成："
cat "$UPDATE_JSON"

exec nginx -g "daemon off;"
