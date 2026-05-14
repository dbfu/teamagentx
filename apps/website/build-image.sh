#!/usr/bin/env bash
# 构建官网 Docker 镜像并推送到腾讯云镜像仓库
#
# 用法：
#   ./build-image.sh                  # 自动从 git tag 或 commit 推导版本号
#   ./build-image.sh v1.2.1           # 手动指定版本号
#   VERSION=v1.2.1 ./build-image.sh   # 环境变量指定
#
# 前提：已在构建机上完成腾讯云 docker login
set -euo pipefail

# ── 镜像仓库配置 ──────────────────────────────────────────────────────────────
REGISTRY="ccr.ccs.tencentyun.com"
REPO="spark_ai/team-agent-x-website"
IMAGE="${REGISTRY}/${REPO}"

# ── 版本号推导 ────────────────────────────────────────────────────────────────
# 优先级：命令行参数 > VERSION 环境变量 > git tag > git 短 SHA
if [ -n "${1:-}" ]; then
  VERSION="$1"
elif [ -n "${VERSION:-}" ]; then
  VERSION="$VERSION"
else
  # 尝试从最近的 git tag 推导
  GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null || true)
  if [ -n "$GIT_TAG" ]; then
    VERSION="$GIT_TAG"
  else
    # 没有 tag 则用 git 短 SHA 作为版本号
    VERSION="git-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
  fi
fi

# 去掉可能的 v 前缀用于 docker tag（保留完整版本用于镜像 label）
TAG="${VERSION#v}"

echo "=================================================="
echo "  镜像仓库 : ${IMAGE}"
echo "  版本标签 : ${TAG}"
echo "  完整版本 : ${VERSION}"
echo "=================================================="

# ── 确定脚本所在目录（支持从任意位置调用） ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── 准备临时 Docker 构建上下文 ────────────────────────────────────────────────
# website 是 workspace 子包，依赖解析需要根目录的 workspace/package/lock 文件。
BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/teamagentx-website-docker.XXXXXX")"
cleanup() {
  rm -rf "${BUILD_CONTEXT}"
}
trap cleanup EXIT

rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  --exclude .env.local \
  --exclude '*.log' \
  "${SCRIPT_DIR}/" "${BUILD_CONTEXT}/"

cp "${ROOT_DIR}/package.json" "${BUILD_CONTEXT}/package.root.json"
cp "${ROOT_DIR}/pnpm-workspace.yaml" "${BUILD_CONTEXT}/pnpm-workspace.yaml"
cp "${ROOT_DIR}/pnpm-lock.yaml" "${BUILD_CONTEXT}/pnpm-lock.yaml"

# ── 构建镜像 ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ 开始构建镜像..."
docker build \
  --platform linux/amd64 \
  --label "org.opencontainers.image.version=${VERSION}" \
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
  --build-arg "VITE_APP_VERSION=${VERSION}" \
  --build-arg "VITE_DOWNLOAD_URL_MAC=${VITE_DOWNLOAD_URL_MAC:-}" \
  --build-arg "VITE_DOWNLOAD_URL_WIN=${VITE_DOWNLOAD_URL_WIN:-}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  -f "${BUILD_CONTEXT}/Dockerfile" \
  "${BUILD_CONTEXT}"

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
