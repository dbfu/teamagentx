#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ccr.ccs.tencentyun.com"
REPO="spark_ai/team-agent-x-download-resolver"
IMAGE="${REGISTRY}/${REPO}"

if [ -n "${1:-}" ]; then
  VERSION="$1"
elif [ -n "${VERSION:-}" ]; then
  VERSION="$VERSION"
else
  GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
  if [ -n "$GIT_TAG" ]; then
    VERSION="$GIT_TAG"
  else
    VERSION="git-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  fi
fi

TAG="${VERSION#v}"

echo "=================================================="
echo "  镜像仓库  : ${IMAGE}"
echo "  版本标签  : ${TAG}"
echo "  完整版本  : ${VERSION}"
echo "=================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "▶ 开始构建镜像..."
docker build \
  --platform linux/amd64 \
  --label "org.opencontainers.image.version=${VERSION}" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  -f "${SCRIPT_DIR}/Dockerfile" \
  "${SCRIPT_DIR}"

echo ""
echo "▶ 推送版本标签 ${IMAGE}:${TAG} ..."
docker push "${IMAGE}:${TAG}"

echo ""
echo "▶ 推送最新标签 ${IMAGE}:latest ..."
docker push "${IMAGE}:latest"

echo ""
echo "✅ 完成！已推送以下镜像："
echo "   ${IMAGE}:${TAG}"
echo "   ${IMAGE}:latest"
