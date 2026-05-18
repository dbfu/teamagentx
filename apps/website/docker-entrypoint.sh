#!/bin/sh
# 容器启动时用运行时环境变量重新生成 update.json，
# 覆盖镜像构建阶段烧入的版本，使 docker run -e 参数立即生效。
set -e

HTML_DIR=/usr/share/nginx/html
UPDATE_JSON="${HTML_DIR}/update.json"

VERSION="${VITE_APP_VERSION:-v1.2.0}"
MAC_URL_ARM64="${VITE_DOWNLOAD_URL_MAC_ARM64:-}"
MAC_URL_X64="${VITE_DOWNLOAD_URL_MAC_X64:-}"
WIN_URL="${VITE_DOWNLOAD_URL_WIN:-}"
IOS_URL="${VITE_DOWNLOAD_URL_IOS:-}"
ANDROID_URL="${VITE_DOWNLOAD_URL_ANDROID:-}"
DOWNLOAD_RESOLVER_URL="${VITE_DOWNLOAD_RESOLVER_URL:-}"
NOTES="${VITE_APP_VERSION_NOTE:-}"

cat > "$UPDATE_JSON" <<EOF
{
  "version": "${VERSION}",
  "macUrlArm64": "${MAC_URL_ARM64}",
  "macUrlX64": "${MAC_URL_X64}",
  "winUrl": "${WIN_URL}",
  "iosUrl": "${IOS_URL}",
  "androidUrl": "${ANDROID_URL}",
  "downloadResolverUrl": "${DOWNLOAD_RESOLVER_URL}",
  "downloads": {
    "macArm64": "${MAC_URL_ARM64}",
    "macX64": "${MAC_URL_X64}",
    "win": "${WIN_URL}",
    "ios": "${IOS_URL}",
    "android": "${ANDROID_URL}"
  },
  "notes": "${NOTES}"
}
EOF

echo "[entrypoint] update.json 已生成："
cat "$UPDATE_JSON"

exec nginx -g "daemon off;"
